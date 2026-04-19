import type { Framework, Step, TestSuite } from './types.js';
import { generateStep } from './codegen.js';

export type ResultStatus = 'passed' | 'failed' | 'skipped' | 'timedOut' | 'interrupted';

export interface StepResult {
  title: string;
  status: ResultStatus;
  durationMs: number;
  error?: string;
}

export interface SpecResult {
  title: string;
  file?: string;
  status: ResultStatus;
  durationMs: number;
  steps: StepResult[];
}

export interface ReportSummary {
  totalSpecs: number;
  passed: number;
  failed: number;
  skipped: number;
  totalDurationMs: number;
  specs: SpecResult[];
}

interface RawStep {
  title?: string;
  duration?: number;
  error?: { message?: string } | null;
  steps?: RawStep[];
}

interface RawResult {
  status?: ResultStatus;
  duration?: number;
  error?: { message?: string } | null;
  steps?: RawStep[];
}

interface RawTest {
  results?: RawResult[];
}

interface RawSpec {
  title?: string;
  file?: string;
  tests?: RawTest[];
}

interface RawSuite {
  title?: string;
  file?: string;
  specs?: RawSpec[];
  suites?: RawSuite[];
}

interface RawReport {
  suites?: RawSuite[];
  stats?: { duration?: number };
}

const rollupStatus = (statuses: ResultStatus[]): ResultStatus => {
  if (statuses.some((s) => s === 'failed')) return 'failed';
  if (statuses.some((s) => s === 'timedOut')) return 'timedOut';
  if (statuses.some((s) => s === 'interrupted')) return 'interrupted';
  if (statuses.length > 0 && statuses.every((s) => s === 'skipped')) return 'skipped';
  return 'passed';
};

const flattenSteps = (steps: RawStep[] | undefined): StepResult[] => {
  if (!steps) return [];
  const out: StepResult[] = [];
  for (const s of steps) {
    const title = s.title ?? '';
    // Playwright emits framework steps (Before Hooks, After Hooks, etc.) —
    // only keep action-like steps so the list lines up with Step[] indices.
    const isAction = /^(page\.|expect|locator\.|frame\.)/.test(title);
    if (isAction) {
      out.push({
        title,
        status: s.error ? 'failed' : 'passed',
        durationMs: Math.max(0, s.duration ?? 0),
        error: s.error?.message,
      });
    }
    if (s.steps && s.steps.length > 0) {
      out.push(...flattenSteps(s.steps));
    }
  }
  return out;
};

const collectSpecs = (suite: RawSuite, acc: SpecResult[]): void => {
  for (const spec of suite.specs ?? []) {
    const tests = spec.tests ?? [];
    // Use only the final attempt per test — Playwright emits one RawResult per
    // retry, and a spec that recovers on retry must not be reported as failed.
    const results: RawResult[] = tests
      .map((t) => {
        const rs = t.results ?? [];
        return rs.length > 0 ? rs[rs.length - 1] : undefined;
      })
      .filter((r): r is RawResult => r !== undefined);
    const stepResults = results.flatMap((r) => flattenSteps(r.steps));
    const statuses = results.map((r) => r.status ?? 'passed');
    const duration = results.reduce((n, r) => n + (r.duration ?? 0), 0);
    const firstErr = results.find((r) => r.error?.message)?.error?.message;
    acc.push({
      title: spec.title ?? '(untitled)',
      file: spec.file ?? suite.file,
      status: rollupStatus(statuses),
      durationMs: Math.max(0, duration),
      steps: firstErr && stepResults.length === 0
        ? [{ title: '(spec error)', status: 'failed', durationMs: 0, error: firstErr }]
        : stepResults,
    });
  }
  for (const child of suite.suites ?? []) collectSpecs(child, acc);
};

/**
 * Parse a Playwright JSON reporter payload (string or already-parsed object).
 * Returns a flat, easy-to-render summary. Unknown shapes resolve to empty.
 */
export function parsePlaywrightReport(input: string | object): ReportSummary {
  let raw: RawReport;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input) as RawReport;
    } catch {
      return { totalSpecs: 0, passed: 0, failed: 0, skipped: 0, totalDurationMs: 0, specs: [] };
    }
  } else {
    raw = (input ?? {}) as RawReport;
  }

  const specs: SpecResult[] = [];
  for (const s of raw.suites ?? []) collectSpecs(s, specs);

  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (const s of specs) {
    if (s.status === 'passed') passed++;
    else if (s.status === 'skipped') skipped++;
    else failed++;
  }

  return {
    totalSpecs: specs.length,
    passed,
    failed,
    skipped,
    totalDurationMs: raw.stats?.duration ?? specs.reduce((n, s) => n + s.durationMs, 0),
    specs,
  };
}

/**
 * Align a suite's Step[] with a SpecResult's StepResult[] by index.
 * If the spec has fewer results than steps, trailing steps get `null`
 * (e.g., test failed early and later steps never ran).
 */
export function correlateSteps(
  suite: TestSuite,
  specResult: SpecResult,
): Array<{ step: Step; result: StepResult | null }> {
  return suite.steps.map((step, i) => ({
    step,
    result: specResult.steps[i] ?? null,
  }));
}

/** True when every step either passed or is null (not-run). */
export function allStepsPassed(specResult: SpecResult): boolean {
  return specResult.steps.every((s) => s.status === 'passed');
}

/**
 * Generate an AI-friendly Markdown report of all failures in a summary.
 */
export function generateBugReport(
  suite: TestSuite,
  report: ReportSummary,
  framework: Framework,
): string {
  const failedSpecs = report.specs.filter((s) => s.status !== 'passed' && s.status !== 'skipped');
  if (failedSpecs.length === 0) return '';

  let out = `# Bug Report: ${suite.name}\n\n`;
  out += `**Summary**: ${report.failed} failed, ${report.passed} passed, ${report.totalSpecs} total.\n\n`;

  for (const spec of failedSpecs) {
    const pairs = correlateSteps(suite, spec);
    const firstFailure = pairs.find((p) => p.result?.status && p.result.status !== 'passed');

    out += `## Spec: ${spec.title}\n`;
    out += `- **Status**: ${spec.status}\n`;
    out += `- **Duration**: ${spec.durationMs}ms\n`;

    if (firstFailure) {
      const { step, result } = firstFailure;
      const index = pairs.indexOf(firstFailure);
      out += `- **Failed Step**: #${index + 1} (${step.type})\n`;
      if (result?.error) {
        out += `- **Error**: \`${result.error.replace(/\n/g, ' ')}\`\n`;
      }

      out += `\n### Context\n`;
      out += `**Step Definition (JSON)**:\n\`\`\`json\n${JSON.stringify(step, null, 2)}\n\`\`\`\n\n`;
      out += `**Generated Code (${framework})**:\n\`\`\`typescript\n${generateStep(step, framework).trim()}\n\`\`\`\n\n`;
    } else if (spec.steps.length > 0 && spec.steps[0].title === '(spec error)') {
      out += `- **Global Error**: ${spec.steps[0].error}\n\n`;
    }

    out += `---\n\n`;
  }

  return out;
}

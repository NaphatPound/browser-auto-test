import { readFile, writeFile, mkdir } from 'node:fs/promises';
import * as path from 'node:path';
import type { Framework, TestSuite } from './types.js';
import { parseSuite } from './storage.js';
import { generate } from './codegen.js';
import { exportSuite, exportFilename } from './exporter.js';
import { bundleSuites, zipBundle } from './bundle.js';
import type { BrowserSettings } from './settings.js';
import { validateSettings } from './settings.js';
import { runSuite as defaultRunSuite, type RunOptions, type RunResult } from './runner.js';
import { parsePlaywrightReport, correlateSteps, generateBugReport } from './reporter.js';

export interface CliIO {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  readFile: (p: string) => Promise<string>;
  writeFile: (p: string, data: string) => Promise<void>;
  mkdir: (p: string) => Promise<void>;
  /** Optional override so tests can stub the runner without spawning a process. */
  runSuite?: (suite: TestSuite, framework: Framework, opts: RunOptions) => Promise<RunResult>;
}

export function defaultIO(): CliIO {
  return {
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
    readFile: (p) => readFile(p, 'utf8'),
    writeFile: async (p, data) => {
      await mkdir(path.dirname(p), { recursive: true });
      await writeFile(p, data, 'utf8');
    },
    mkdir: async (p) => {
      await mkdir(p, { recursive: true });
    },
  };
}

const FRAMEWORKS: Framework[] = ['playwright', 'puppeteer', 'cypress'];

const USAGE = `auto-test — record / generate / bundle browser tests

Usage:
  auto-test gen <suite.json> --framework <fw> [--out <file>] [--settings <settings.json>]
  auto-test export <suite.json> --framework <fw> --out <dir> [--settings <settings.json>]
  auto-test bundle <suite.json> [<suite.json>...] --framework <fw> --out <dir>
         [--settings <settings.json>] [--package-name <name>] [--version <ver>]
         [--zip <file.zip>]
  auto-test run <suite.json> --framework <fw> [--cwd <dir>] [--timeout <ms>]
         [--command <bin>] [--report <file>] [--export-bugs <file.md>]
  auto-test report <suite.json> <report.json> [--spec <n> | --all] [--json]
         [--filter <status[,status...]>]   (only with --all)
         [--failed-only]                   (shorthand for --all --filter failed)
         [--invert]                        (only with --all --filter)
         [--sort <duration|duration-asc>]  (only with --all)
         [--top <N>]                       (only with --all)
         [--summary-only]                  (only with --all)
         [--export-bugs <file.md>]
  auto-test --help | -h
  auto-test --version

Frameworks: playwright | puppeteer | cypress
`;

const VERSION = '0.1.0';

interface ParsedArgs {
  command: string;
  positional: string[];
  flags: Record<string, string | true>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  let command = '';
  let start = 0;
  if (argv.length > 0 && !argv[0].startsWith('-')) {
    command = argv[0];
    start = 1;
  }
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = start; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else if (a.startsWith('-') && a.length === 2) {
      flags[a.slice(1)] = true;
    } else {
      positional.push(a);
    }
  }
  return { command, positional, flags };
}

function requireFramework(flags: Record<string, string | true>): Framework {
  const fw = flags.framework;
  if (typeof fw !== 'string') {
    throw new Error('--framework is required (playwright | puppeteer | cypress)');
  }
  if (!FRAMEWORKS.includes(fw as Framework)) {
    throw new Error(`unknown framework "${fw}" — use one of ${FRAMEWORKS.join(', ')}`);
  }
  return fw as Framework;
}

async function loadSettings(
  io: CliIO,
  flags: Record<string, string | true>,
): Promise<BrowserSettings | undefined> {
  const p = flags.settings;
  if (typeof p !== 'string') return undefined;
  const raw = await io.readFile(p);
  const parsed = JSON.parse(raw) as BrowserSettings;
  const errors = validateSettings(parsed);
  if (errors.length > 0) {
    throw new Error(`invalid settings: ${errors.join('; ')}`);
  }
  return parsed;
}

async function loadSuiteFile(io: CliIO, p: string): Promise<TestSuite> {
  const raw = await io.readFile(p);
  return parseSuite(raw);
}

async function cmdGen(
  args: ParsedArgs,
  io: CliIO,
): Promise<number> {
  const input = args.positional[0];
  if (!input) {
    io.stderr('gen: missing <suite.json>\n');
    return 2;
  }
  const framework = requireFramework(args.flags);
  const suite = await loadSuiteFile(io, input);
  const code = generate(suite, framework);
  const out = args.flags.out;
  if (typeof out === 'string') {
    await io.writeFile(out, code);
    io.stdout(`wrote ${out}\n`);
  } else {
    io.stdout(code);
  }
  return 0;
}

async function cmdExport(
  args: ParsedArgs,
  io: CliIO,
): Promise<number> {
  const input = args.positional[0];
  if (!input) {
    io.stderr('export: missing <suite.json>\n');
    return 2;
  }
  const framework = requireFramework(args.flags);
  const out = args.flags.out;
  if (typeof out !== 'string') {
    io.stderr('export: --out <dir> is required\n');
    return 2;
  }
  const suite = await loadSuiteFile(io, input);
  const settings = await loadSettings(io, args.flags);
  const file = await exportSuite(suite, framework, out, settings);
  io.stdout(`wrote ${file}\n`);
  return 0;
}

async function cmdBundle(
  args: ParsedArgs,
  io: CliIO,
): Promise<number> {
  if (args.positional.length === 0) {
    io.stderr('bundle: at least one <suite.json> is required\n');
    return 2;
  }
  const framework = requireFramework(args.flags);
  const out = args.flags.out;
  if (typeof out !== 'string') {
    io.stderr('bundle: --out <dir> is required\n');
    return 2;
  }
  const suites: TestSuite[] = [];
  for (const p of args.positional) suites.push(await loadSuiteFile(io, p));
  const settings = await loadSettings(io, args.flags);
  const packageName = typeof args.flags['package-name'] === 'string'
    ? (args.flags['package-name'] as string)
    : undefined;
  const version = typeof args.flags.version === 'string'
    ? (args.flags.version as string)
    : undefined;
  const zip = typeof args.flags.zip === 'string' ? args.flags.zip : undefined;
  if (zip) {
    const { bundle, zip: zipRes } = await zipBundle(suites, framework, out, zip, {
      settings,
      packageName,
      version,
    });
    io.stdout(`bundled ${suites.length} suite(s) into ${bundle.outDir}\n`);
    io.stdout(`zipped ${zipRes.entries} file(s) → ${zipRes.outPath} (${zipRes.size} bytes)\n`);
    return 0;
  }
  const result = await bundleSuites(suites, framework, out, {
    settings,
    packageName,
    version,
  });
  io.stdout(`bundled ${suites.length} suite(s) into ${result.outDir}\n`);
  for (const f of result.files) io.stdout(`  ${f}\n`);
  return 0;
}

async function cmdRun(
  args: ParsedArgs,
  io: CliIO,
): Promise<number> {
  const input = args.positional[0];
  if (!input) {
    io.stderr('run: missing <suite.json>\n');
    return 2;
  }
  const framework = requireFramework(args.flags);
  const suite = await loadSuiteFile(io, input);
  const cwd = typeof args.flags.cwd === 'string' ? args.flags.cwd : undefined;
  const command = typeof args.flags.command === 'string' ? args.flags.command : undefined;
  let timeoutMs: number | undefined;
  if (typeof args.flags.timeout === 'string') {
    const n = Number(args.flags.timeout);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error(`--timeout must be a non-negative number, got "${args.flags.timeout}"`);
    }
    timeoutMs = n;
  }
  const reportPath = typeof args.flags.report === 'string' ? args.flags.report : undefined;
  const exportBugsPath = typeof args.flags['export-bugs'] === 'string' ? args.flags['export-bugs'] : undefined;
  let extraArgs: string[] | undefined;
  let env: Record<string, string> | undefined;
  if (reportPath || exportBugsPath) {
    if (framework !== 'playwright') {
      throw new Error('--report and --export-bugs are currently only supported for playwright');
    }
    extraArgs = ['--reporter=json'];
    // If user provided --report, use it. Otherwise use a temporary path for JSON report.
    const actualReportPath = reportPath ? path.resolve(reportPath) : path.join(cwd ?? '.', '.report.json');
    env = { PLAYWRIGHT_JSON_OUTPUT_NAME: actualReportPath };

    const runner = io.runSuite ?? defaultRunSuite;
    const result = await runner(suite, framework, {
      cwd,
      timeoutMs,
      command,
      extraArgs,
      env,
      onStdout: (c) => io.stdout(c),
      onStderr: (c) => io.stderr(c),
    });
    const verdict = result.passed ? 'PASS' : 'FAIL';
    io.stdout(`\n${verdict} ${suite.name} (exit ${result.exitCode}, ${result.durationMs}ms)\n`);

    if (reportPath || exportBugsPath) {
      try {
        const actualPath = reportPath ? path.resolve(reportPath) : path.join(cwd ?? '.', '.report.json');
        const reportRaw = await io.readFile(actualPath);
        const report = parsePlaywrightReport(reportRaw);
        if (reportPath) {
          io.stdout('\n');
          renderReportText(io, suite, report, 'all');
        }
        if (exportBugsPath && report.failed > 0) {
          const bugMd = generateBugReport(suite, report, framework);
          await io.writeFile(exportBugsPath, bugMd);
          io.stdout(`\nexported ${report.failed} bug(s) to ${exportBugsPath}\n`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const p = reportPath ?? '.report.json';
        io.stderr(`run: could not read report "${p}": ${msg}\n`);
      }
    }
    return result.passed ? 0 : 1;
  }
  const runner = io.runSuite ?? defaultRunSuite;
  const result = await runner(suite, framework, {
    cwd,
    timeoutMs,
    command,
    extraArgs,
    env,
    onStdout: (c) => io.stdout(c),
    onStderr: (c) => io.stderr(c),
  });
  const verdict = result.passed ? 'PASS' : 'FAIL';
  io.stdout(`\n${verdict} ${suite.name} (exit ${result.exitCode}, ${result.durationMs}ms)\n`);
  return result.passed ? 0 : 1;
}

function stepLabel(step: import('./types.js').Step): string {
  if (step.locator) return `${step.type} ${step.locator.strategy}=${step.locator.value}`;
  if (step.url) return `${step.type} ${step.url}`;
  if (step.text) return `${step.type} "${step.text}"`;
  return step.type;
}

function renderSpecText(
  io: CliIO,
  suite: TestSuite,
  spec: import('./reporter.js').SpecResult,
): void {
  const pairs = correlateSteps(suite, spec);
  io.stdout(`${spec.title}: ${spec.status} (${spec.durationMs}ms)\n`);
  for (let i = 0; i < pairs.length; i++) {
    const { step, result } = pairs[i];
    const marker = result == null ? '--' : result.status === 'passed' ? 'OK' : 'XX';
    const status = result?.status ?? 'not run';
    const dur = result ? ` (${result.durationMs}ms)` : '';
    io.stdout(`  [${marker}] ${i + 1}. ${stepLabel(step)} — ${status}${dur}\n`);
    if (result?.error) io.stdout(`       ${result.error}\n`);
  }
}

function specEnvelope(
  suite: TestSuite,
  spec: import('./reporter.js').SpecResult,
  specIndex: number,
  report: import('./reporter.js').ReportSummary,
) {
  const pairs = correlateSteps(suite, spec);
  return {
    suite: suite.name,
    spec: {
      index: specIndex,
      title: spec.title,
      file: spec.file,
      status: spec.status,
      durationMs: spec.durationMs,
    },
    totalSpecs: report.totalSpecs,
    summary: {
      passed: report.passed,
      failed: report.failed,
      skipped: report.skipped,
      totalDurationMs: report.totalDurationMs,
    },
    pairs: pairs.map(({ step, result }, i) => ({
      index: i,
      step,
      label: stepLabel(step),
      result,
    })),
  };
}

/** Render a parsed report either as text (one or all specs) for humans. */
function renderReportText(
  io: CliIO,
  suite: TestSuite,
  report: import('./reporter.js').ReportSummary,
  which: number | 'all',
  indicesOverride?: number[],
): void {
  if (report.totalSpecs === 0) {
    io.stdout('(no specs in report)\n');
    return;
  }
  const indices =
    indicesOverride ?? (which === 'all' ? report.specs.map((_, i) => i) : [which]);
  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i];
    const spec = report.specs[idx];
    if (i > 0) io.stdout('\n');
    if (which === 'all') io.stdout(`--- spec ${idx + 1}/${report.totalSpecs} ---\n`);
    renderSpecText(io, suite, spec);
  }
  io.stdout(
    `\n${report.passed} passed, ${report.failed} failed, ${report.skipped} skipped` +
      ` (${report.totalDurationMs}ms total)\n`,
  );
}

const FILTER_STATUSES: import('./reporter.js').ResultStatus[] = [
  'passed',
  'failed',
  'skipped',
  'timedOut',
  'interrupted',
];

type SortKey = 'duration' | 'duration-asc';
const SORT_KEYS: SortKey[] = ['duration', 'duration-asc'];

function parseSort(raw: string): SortKey {
  if (!SORT_KEYS.includes(raw as SortKey)) {
    throw new Error(
      `--sort: unknown key "${raw}" — use one of ${SORT_KEYS.join(', ')}`,
    );
  }
  return raw as SortKey;
}

function sortIndices(
  indices: number[],
  specs: import('./reporter.js').SpecResult[],
  sort: SortKey,
): number[] {
  const dir = sort === 'duration-asc' ? 1 : -1;
  return [...indices].sort((a, b) => {
    const diff = (specs[a].durationMs - specs[b].durationMs) * dir;
    return diff !== 0 ? diff : a - b;
  });
}

function parseTop(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`--top must be a positive integer, got "${raw}"`);
  }
  return n;
}

function parseFilter(raw: string): import('./reporter.js').ResultStatus[] {
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) {
    throw new Error('--filter requires at least one status (passed | failed | skipped | timedOut | interrupted)');
  }
  const seen = new Set<string>();
  const out: import('./reporter.js').ResultStatus[] = [];
  for (const p of parts) {
    if (!FILTER_STATUSES.includes(p as import('./reporter.js').ResultStatus)) {
      throw new Error(
        `--filter: unknown status "${p}" — use one of ${FILTER_STATUSES.join(', ')}`,
      );
    }
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p as import('./reporter.js').ResultStatus);
    }
  }
  return out;
}

async function cmdReport(
  args: ParsedArgs,
  io: CliIO,
): Promise<number> {
  const suiteFile = args.positional[0];
  const reportFile = args.positional[1];
  if (!suiteFile) {
    io.stderr('report: missing <suite.json>\n');
    return 2;
  }
  if (!reportFile) {
    io.stderr('report: missing <report.json>\n');
    return 2;
  }
  const failedOnly = args.flags['failed-only'] === true;
  if (failedOnly) {
    if (args.flags.spec !== undefined) {
      throw new Error('--failed-only and --spec are mutually exclusive');
    }
    if (args.flags.filter !== undefined) {
      throw new Error('--failed-only and --filter are mutually exclusive (--failed-only is a shorthand for --filter failed)');
    }
    if (args.flags.invert === true) {
      throw new Error('--failed-only and --invert are mutually exclusive');
    }
  }
  const wantAll = args.flags.all === true || failedOnly;
  let specIndex = 0;
  if (typeof args.flags.spec === 'string') {
    if (wantAll) {
      throw new Error('--spec and --all are mutually exclusive');
    }
    const n = Number(args.flags.spec);
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(`--spec must be a positive integer, got "${args.flags.spec}"`);
    }
    specIndex = n - 1;
  }
  let filter: import('./reporter.js').ResultStatus[] | undefined;
  if (failedOnly) {
    filter = ['failed'];
  } else if (args.flags.filter !== undefined) {
    if (!wantAll) {
      throw new Error('--filter requires --all');
    }
    if (typeof args.flags.filter !== 'string') {
      throw new Error('--filter requires a value (passed | failed | skipped | timedOut | interrupted)');
    }
    filter = parseFilter(args.flags.filter);
  }
  const invert = args.flags.invert === true;
  if (invert && !wantAll) {
    throw new Error('--invert requires --all');
  }
  if (invert && !filter) {
    throw new Error('--invert requires --filter');
  }
  let sort: SortKey | undefined;
  if (args.flags.sort !== undefined) {
    if (!wantAll) {
      throw new Error('--sort requires --all');
    }
    if (typeof args.flags.sort !== 'string') {
      throw new Error(`--sort requires a value (${SORT_KEYS.join(' | ')})`);
    }
    sort = parseSort(args.flags.sort);
  }
  let top: number | undefined;
  if (args.flags.top !== undefined) {
    if (!wantAll) {
      throw new Error('--top requires --all');
    }
    if (typeof args.flags.top !== 'string') {
      throw new Error('--top must be a positive integer (no value provided)');
    }
    top = parseTop(args.flags.top);
  }
  const summaryOnly = args.flags['summary-only'] === true;
  if (summaryOnly && !wantAll) {
    throw new Error('--summary-only requires --all');
  }
  const exportBugsPath = typeof args.flags['export-bugs'] === 'string' ? args.flags['export-bugs'] : undefined;
  const emitJson = args.flags.json === true;
  const suite = await loadSuiteFile(io, suiteFile);
  const reportRaw = await io.readFile(reportFile);
  const report = parsePlaywrightReport(reportRaw);

  if (exportBugsPath && report.failed > 0) {
    // We don't have the framework here easily because it's not a required flag for 'report'
    // but the user should provide it if they want accurate code snippets.
    // Default to playwright for now or look for it in flags.
    const fw = (args.flags.framework as import('./types.js').Framework) ?? 'playwright';
    const bugMd = generateBugReport(suite, report, fw);
    await io.writeFile(exportBugsPath, bugMd);
    io.stdout(`exported ${report.failed} bug(s) to ${exportBugsPath}\n`);
  }

  if (report.totalSpecs === 0) {
    if (emitJson) {
      const payload = wantAll
        ? { suite: suite.name, totalSpecs: 0, specs: [] }
        : { suite: suite.name, spec: null, totalSpecs: 0, pairs: [] };
      io.stdout(JSON.stringify(payload, null, 2) + '\n');
      return 0;
    }
    io.stdout('(no specs in report)\n');
    return 0;
  }
  if (!wantAll && specIndex >= report.specs.length) {
    io.stderr(
      `report: --spec ${specIndex + 1} out of range (report has ${report.specs.length} spec${report.specs.length === 1 ? '' : 's'})\n`,
    );
    return 2;
  }
  if (wantAll) {
    let indices = filter
      ? report.specs
          .map((s, i) => {
            const matches = filter!.includes(s.status);
            return (invert ? !matches : matches) ? i : -1;
          })
          .filter((i) => i >= 0)
      : report.specs.map((_, i) => i);
    if (sort) indices = sortIndices(indices, report.specs, sort);
    if (top !== undefined) indices = indices.slice(0, top);
    if (emitJson) {
      const payload: Record<string, unknown> = {
        suite: suite.name,
        totalSpecs: report.totalSpecs,
        summary: {
          passed: report.passed,
          failed: report.failed,
          skipped: report.skipped,
          totalDurationMs: report.totalDurationMs,
        },
        specs: summaryOnly
          ? []
          : indices.map((i) => specEnvelope(suite, report.specs[i], i, report)),
      };
      if (filter) payload.filter = filter;
      if (invert) payload.invert = true;
      if (sort) payload.sort = sort;
      if (top !== undefined) payload.top = top;
      if (summaryOnly) payload.summaryOnly = true;
      io.stdout(JSON.stringify(payload, null, 2) + '\n');
    } else if (summaryOnly) {
      io.stdout(
        `${report.passed} passed, ${report.failed} failed, ${report.skipped} skipped` +
          ` (${report.totalDurationMs}ms total)\n`,
      );
    } else {
      if (filter && indices.length === 0) {
        const suffix = invert ? ' --invert' : '';
        io.stdout(`(no specs match --filter ${filter.join(',')}${suffix})\n`);
        io.stdout(
          `\n${report.passed} passed, ${report.failed} failed, ${report.skipped} skipped` +
            ` (${report.totalDurationMs}ms total)\n`,
        );
      } else {
        renderReportText(io, suite, report, 'all', indices);
      }
    }
    return report.failed === 0 ? 0 : 1;
  }
  const spec = report.specs[specIndex];
  if (emitJson) {
    io.stdout(JSON.stringify(specEnvelope(suite, spec, specIndex, report), null, 2) + '\n');
    return spec.status === 'passed' ? 0 : 1;
  }
  renderReportText(io, suite, report, specIndex);
  return spec.status === 'passed' ? 0 : 1;
}

/**
 * Runs the CLI with the given argv (argv[0] is the command, not the binary).
 * Returns a process-style exit code. Never calls process.exit so it stays
 * testable. Unknown errors → exit 1 with message on stderr.
 */
export async function runCli(argv: string[], io: CliIO = defaultIO()): Promise<number> {
  const args = parseArgs(argv);
  // Only the top-level `--version` (no command, boolean flag) prints the tool
  // version. `bundle ... --version 9.9.9` passes a string value and must fall
  // through to cmdBundle.
  if (args.command === '' && args.flags.version === true) {
    io.stdout(`${VERSION}\n`);
    return 0;
  }
  if (args.command === '' || args.command === 'help' || args.flags.help || args.flags.h) {
    io.stdout(USAGE);
    return 0;
  }
  try {
    switch (args.command) {
      case 'gen':
        return await cmdGen(args, io);
      case 'export':
        return await cmdExport(args, io);
      case 'bundle':
        return await cmdBundle(args, io);
      case 'run':
        return await cmdRun(args, io);
      case 'report':
        return await cmdReport(args, io);
      default:
        io.stderr(`unknown command "${args.command}"\n\n${USAGE}`);
        return 2;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    io.stderr(`${args.command}: ${msg}\n`);
    return 1;
  }
}

export function filenameFor(suite: TestSuite, framework: Framework): string {
  return exportFilename(suite, framework);
}

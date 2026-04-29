const inlineText = (value) => String(value ?? '').replace(/\r?\n/g, ' ').trim();

export function locatorLabel(locator) {
  if (!locator) return '';
  return `${locator.strategy}=${locator.value}`;
}

export function describeStep(step, options = {}) {
  if (!step) return '';
  const includeNote = options.includeNote === true;

  if (step.type === 'comment') {
    const target = step.locator ? locatorLabel(step.locator) : 'page';
    const note = inlineText(step.note || step.text || '');
    return note ? `${target} - ${note}` : target;
  }

  if (step.type === 'navigate') return step.url || '';
  if (step.type === 'wait') return `${(step.timeoutMs || 0) / 1000}s (${step.timeoutMs || 0}ms)`;

  const loc = step.locator ? locatorLabel(step.locator) : '';
  const extra = step.text
    ? ` "${step.text}"`
    : step.selectValue
      ? ` = ${step.selectValue}`
      : step.key
        ? ` [${step.key}]`
        : '';
  const note = includeNote && step.note ? ` // ${inlineText(step.note)}` : '';
  return `${loc}${extra}${note}`;
}

export function createEmptyDiagnostics() {
  return { console: [], network: [], page: [] };
}

export function diagnosticsCounts(diagnostics) {
  const bag = diagnostics || createEmptyDiagnostics();
  const consoleCount = Array.isArray(bag.console) ? bag.console.length : 0;
  const networkCount = Array.isArray(bag.network) ? bag.network.length : 0;
  const pageCount = Array.isArray(bag.page) ? bag.page.length : 0;
  return {
    consoleCount,
    networkCount,
    pageCount,
    total: consoleCount + networkCount + pageCount,
  };
}

export function getAnnotatedSteps(steps) {
  return (steps || []).filter((step) => step && typeof step.note === 'string' && step.note.trim().length > 0);
}

function reportStatus(replay) {
  const failures = (replay?.results || []).filter((r) => r.status === 'failed').length;
  if (failures > 0) return 'FAILED';
  return diagnosticsCounts(replay?.diagnostics).total > 0 ? 'ISSUES DETECTED' : 'ALL PASSED';
}

function pushIssueContext(lines, issue, steps) {
  if (!Number.isInteger(issue?.stepIndex)) return;
  const step = steps[issue.stepIndex];
  if (!step) return;
  lines.push(`- **Observed near step**: #${issue.stepIndex + 1} \`${step.type}\` — \`${describeStep(step)}\``);
}

function pushAnnotationSection(lines, steps) {
  const annotations = getAnnotatedSteps(steps);
  if (annotations.length === 0) return;
  lines.push('## Annotated Elements');
  lines.push('');
  annotations.forEach((step, index) => {
    lines.push(`### Note #${index + 1}`);
    if (step.locator) lines.push(`- **Target**: \`${locatorLabel(step.locator)}\``);
    if (step.pageUrl) lines.push(`- **Page**: ${step.pageUrl}`);
    lines.push(`- **Comment**: ${step.note}`);
    lines.push('');
  });
}

function pushFailureSection(lines, replay, steps, generateStepCode) {
  const failed = (replay?.results || []).filter((r) => r.status === 'failed');
  if (failed.length === 0) return;
  lines.push('## Replay Failures');
  lines.push('');
  for (const result of failed) {
    const step = steps[result.index];
    if (!step) continue;
    lines.push(`### Step #${result.index + 1} - ${result.type}`);
    lines.push(`- **Duration**: ${result.durationMs}ms`);
    lines.push(`- **Description**: \`${describeStep(step, { includeNote: true })}\``);
    if (step.note) lines.push(`- **Recorder note**: ${step.note}`);
    lines.push(`- **Error**: \`${inlineText(result.error || 'unknown')}\``);
    lines.push('');
    lines.push('#### Step Definition (JSON)');
    lines.push('```json');
    lines.push(JSON.stringify(step, null, 2));
    lines.push('```');
    lines.push('');
    const code = typeof generateStepCode === 'function' ? generateStepCode(step) : '';
    if (code) {
      lines.push(`#### Generated Code (${replay.framework})`);
      lines.push('```typescript');
      lines.push(code);
      lines.push('```');
      lines.push('');
    }
  }
}

function pushConsoleSection(lines, replay, steps) {
  const issues = replay?.diagnostics?.console || [];
  if (issues.length === 0) return;
  lines.push('## Console Issues');
  lines.push('');
  issues.forEach((issue, index) => {
    lines.push(`### Console #${index + 1} - ${issue.level}`);
    lines.push(`- **Message**: \`${inlineText(issue.message)}\``);
    if (issue.sourceId) {
      const where = issue.line ? `${issue.sourceId}:${issue.line}` : issue.sourceId;
      lines.push(`- **Source**: \`${where}\``);
    }
    pushIssueContext(lines, issue, steps);
    lines.push('');
  });
}

function pushPageSection(lines, replay, steps) {
  const issues = replay?.diagnostics?.page || [];
  if (issues.length === 0) return;
  lines.push('## Runtime Exceptions');
  lines.push('');
  issues.forEach((issue, index) => {
    lines.push(`### Runtime #${index + 1}`);
    lines.push(`- **Message**: \`${inlineText(issue.message)}\``);
    if (issue.source) lines.push(`- **Source**: \`${issue.source}\``);
    pushIssueContext(lines, issue, steps);
    if (issue.stack) {
      lines.push('');
      lines.push('```text');
      lines.push(String(issue.stack).trim());
      lines.push('```');
    }
    lines.push('');
  });
}

function pushNetworkSection(lines, replay, steps) {
  const issues = replay?.diagnostics?.network || [];
  if (issues.length === 0) return;
  lines.push('## Network Issues');
  lines.push('');
  issues.forEach((issue, index) => {
    lines.push(`### Request #${index + 1} - ${issue.source}`);
    const method = issue.method || 'GET';
    lines.push(`- **Request**: \`${method} ${issue.url || '(unknown URL)'}\``);
    if (Number.isFinite(issue.status) && issue.status > 0) {
      const suffix = issue.statusText ? ` ${issue.statusText}` : '';
      lines.push(`- **Status**: \`${issue.status}${suffix}\``);
    }
    if (issue.resourceType) lines.push(`- **Resource Type**: \`${issue.resourceType}\``);
    if (issue.error) lines.push(`- **Error**: \`${inlineText(issue.error)}\``);
    pushIssueContext(lines, issue, steps);
    lines.push('');
  });
}

function pushTimelineSection(lines, replay, steps) {
  lines.push('## Full Step Timeline');
  lines.push('');
  lines.push('| # | Type | Status | Duration | Description |');
  lines.push('|---|------|--------|----------|-------------|');
  const results = replay?.results || [];
  results.forEach((result, index) => {
    const step = steps[result.index] || steps[index];
    const status = result.status === 'passed' ? 'passed' : 'failed';
    const desc = describeStep(step, { includeNote: true }).replace(/\|/g, '\\|');
    lines.push(`| ${result.index + 1} | ${result.type} | ${status} | ${result.durationMs}ms | \`${desc}\` |`);
  });
}

function pushRecordingDiagnosticsSection(lines, diagnostics, steps) {
  if (!diagnostics) return;
  const counts = diagnosticsCounts(diagnostics);
  if (counts.total === 0) return;

  lines.push('## Issues Captured During Recording');
  lines.push('');
  lines.push(
    `Captured **${counts.consoleCount}** console, **${counts.pageCount}** runtime, **${counts.networkCount}** network issue(s) while QA was interacting with the page.`,
  );
  lines.push('');

  const consoleIssues = diagnostics.console || [];
  if (consoleIssues.length > 0) {
    lines.push('### Console Errors');
    lines.push('');
    consoleIssues.forEach((issue, index) => {
      lines.push(`#### Console #${index + 1} - ${issue.level || 'error'}`);
      lines.push(`- **Message**: \`${inlineText(issue.message)}\``);
      if (issue.sourceId) {
        const where = issue.line ? `${issue.sourceId}:${issue.line}` : issue.sourceId;
        lines.push(`- **Source**: \`${where}\``);
      }
      pushIssueContext(lines, issue, steps);
      lines.push('');
    });
  }

  const pageIssues = diagnostics.page || [];
  if (pageIssues.length > 0) {
    lines.push('### Runtime Exceptions');
    lines.push('');
    pageIssues.forEach((issue, index) => {
      lines.push(`#### Runtime #${index + 1}`);
      lines.push(`- **Message**: \`${inlineText(issue.message)}\``);
      if (issue.source) lines.push(`- **Source**: \`${issue.source}\``);
      pushIssueContext(lines, issue, steps);
      if (issue.stack) {
        lines.push('');
        lines.push('```text');
        lines.push(String(issue.stack).trim());
        lines.push('```');
      }
      lines.push('');
    });
  }

  const networkIssues = diagnostics.network || [];
  if (networkIssues.length > 0) {
    lines.push('### Network Errors');
    lines.push('');
    networkIssues.forEach((issue, index) => {
      lines.push(`#### Request #${index + 1} - ${issue.source || 'request'}`);
      const method = issue.method || 'GET';
      lines.push(`- **Request**: \`${method} ${issue.url || '(unknown URL)'}\``);
      if (Number.isFinite(issue.status) && issue.status > 0) {
        const suffix = issue.statusText ? ` ${issue.statusText}` : '';
        lines.push(`- **Status**: \`${issue.status}${suffix}\``);
      }
      if (issue.resourceType) lines.push(`- **Resource Type**: \`${issue.resourceType}\``);
      if (issue.error) lines.push(`- **Error**: \`${inlineText(issue.error)}\``);
      pushIssueContext(lines, issue, steps);
      lines.push('');
    });
  }
}

function pushRecordedStepsSection(lines, steps) {
  if (steps.length === 0) return;
  lines.push('## Recorded Steps');
  lines.push('');
  lines.push('| # | Type | Description |');
  lines.push('|---|------|-------------|');
  steps.forEach((step, index) => {
    const desc = describeStep(step, { includeNote: true }).replace(/\|/g, '\\|');
    lines.push(`| ${index + 1} | ${step.type} | \`${desc}\` |`);
  });
  lines.push('');
}

export function buildBugReport(replay, steps, options = {}) {
  const safeSteps = Array.isArray(steps) ? steps : [];
  const lines = [];

  if (!replay) {
    const suiteName = 'recorded flow';
    const annotations = getAnnotatedSteps(safeSteps);
    const recordingCounts = diagnosticsCounts(options.recordingDiagnostics);
    const status =
      annotations.length > 0 || recordingCounts.total > 0
        ? 'BUGS REPORTED'
        : 'NO REPLAY';
    lines.push(`# Bug Report: ${suiteName}`);
    lines.push('');
    lines.push(`**Status**: ${status}`);
    lines.push(`**Recorded steps**: ${safeSteps.length}`);
    lines.push(`**Annotated bugs**: ${annotations.length}`);
    lines.push(
      `**Captured issues**: ${recordingCounts.consoleCount} console, ${recordingCounts.pageCount} runtime, ${recordingCounts.networkCount} network`,
    );
    lines.push(`**Base URL**: ${options.baseUrl || '(none)'}`);
    lines.push(`**Captured at**: ${new Date().toISOString()}`);
    lines.push('');
    lines.push('> This report was exported without a replay. It contains the recorded interactions, any bug notes/comments captured during testing, and any console/network errors observed while the QA was interacting with the page — useful for handing off to a developer or AI to investigate.');
    lines.push('');

    if (options.summary && String(options.summary).trim()) {
      lines.push('## Recorder Summary');
      lines.push('');
      lines.push(String(options.summary).trim());
      lines.push('');
    }

    pushAnnotationSection(lines, safeSteps);
    pushRecordingDiagnosticsSection(lines, options.recordingDiagnostics, safeSteps);
    pushRecordedStepsSection(lines, safeSteps);
    return lines.join('\n');
  }

  const suiteName = replay?.suiteName || 'recorded flow';
  const results = replay?.results || [];
  const failed = results.filter((r) => r.status === 'failed');
  const passed = results.length - failed.length;
  const counts = diagnosticsCounts(replay?.diagnostics);

  lines.push(`# Bug Report: ${suiteName}`);
  lines.push('');
  lines.push(`**Status**: ${reportStatus(replay)}`);
  lines.push(
    `**Summary**: ${failed.length} step failure(s), ${counts.consoleCount} console issue(s), ${counts.pageCount} runtime exception(s), ${counts.networkCount} network issue(s), ${passed} passed step(s), ${results.length} total step(s).`,
  );
  lines.push(`**Framework**: ${replay?.framework || 'playwright'}`);
  lines.push(`**Base URL**: ${replay?.baseUrl || '(none)'}`);
  lines.push(`**Replay started**: ${replay?.startedAt || '(unknown)'}`);
  lines.push(`**Total duration**: ${replay?.totalMs || 0}ms`);
  lines.push('');

  if (options.summary && String(options.summary).trim()) {
    lines.push('## Recorder Summary');
    lines.push('');
    lines.push(String(options.summary).trim());
    lines.push('');
  }

  pushAnnotationSection(lines, safeSteps);
  pushRecordingDiagnosticsSection(lines, options.recordingDiagnostics, safeSteps);
  pushFailureSection(lines, replay, safeSteps, options.generateStepCode);
  pushConsoleSection(lines, replay, safeSteps);
  pushPageSection(lines, replay, safeSteps);
  pushNetworkSection(lines, replay, safeSteps);

  if (failed.length === 0 && counts.total === 0) {
    lines.push('No failures or runtime issues were detected during replay.');
    lines.push('');
  }

  pushTimelineSection(lines, replay, safeSteps);
  return lines.join('\n');
}

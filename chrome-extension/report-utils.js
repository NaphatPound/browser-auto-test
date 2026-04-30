'use strict';

// Markdown report builder for the Chrome extension. Mirrors app/report-utils.js
// but is self-contained (no module imports) so it can be loaded both in the
// background service worker (importScripts) and in popup.html (<script src>).
// Exposes itself on globalThis as `AutoTestReport`.

(function (root) {
  const inlineText = (v) => String(v == null ? '' : v).replace(/\r?\n/g, ' ').trim();

  function locatorLabel(loc) {
    if (!loc) return '';
    return `${loc.strategy}=${loc.value}`;
  }

  function describeStep(step, options) {
    options = options || {};
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

  function createEmptyDiagnostics() {
    return { console: [], network: [], page: [] };
  }

  function diagnosticsCounts(d) {
    const bag = d || createEmptyDiagnostics();
    const c = Array.isArray(bag.console) ? bag.console.length : 0;
    const n = Array.isArray(bag.network) ? bag.network.length : 0;
    const p = Array.isArray(bag.page) ? bag.page.length : 0;
    return { consoleCount: c, networkCount: n, pageCount: p, total: c + n + p };
  }

  function getAnnotated(steps) {
    return (steps || []).filter((s) => s && typeof s.note === 'string' && s.note.trim());
  }

  function pushIssueContext(lines, issue, steps) {
    if (!issue || !Number.isInteger(issue.stepIndex)) return;
    const step = steps[issue.stepIndex];
    if (!step) return;
    lines.push(`- **Observed near step**: #${issue.stepIndex + 1} \`${step.type}\` — \`${describeStep(step)}\``);
  }

  function pushAnnotations(lines, steps) {
    const anns = getAnnotated(steps);
    if (anns.length === 0) return;
    lines.push('## Annotated Elements');
    lines.push('');
    anns.forEach((s, i) => {
      lines.push(`### Note #${i + 1}`);
      if (s.locator) lines.push(`- **Target**: \`${locatorLabel(s.locator)}\``);
      if (s.pageUrl) lines.push(`- **Page**: ${s.pageUrl}`);
      lines.push(`- **Comment**: ${s.note}`);
      lines.push('');
    });
  }

  function pushRecordingIssues(lines, diagnostics, steps) {
    if (!diagnostics) return;
    const counts = diagnosticsCounts(diagnostics);
    if (counts.total === 0) return;

    lines.push('## Issues Captured During Recording');
    lines.push('');
    lines.push(`Captured **${counts.consoleCount}** console, **${counts.pageCount}** runtime, **${counts.networkCount}** network issue(s) while QA was interacting with the page.`);
    lines.push('');

    const consoleIssues = diagnostics.console || [];
    if (consoleIssues.length > 0) {
      lines.push('### Console Errors');
      lines.push('');
      consoleIssues.forEach((issue, i) => {
        lines.push(`#### Console #${i + 1} - ${issue.level || 'error'}`);
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
      pageIssues.forEach((issue, i) => {
        lines.push(`#### Runtime #${i + 1}`);
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

    const netIssues = diagnostics.network || [];
    if (netIssues.length > 0) {
      lines.push('### Network Errors');
      lines.push('');
      netIssues.forEach((issue, i) => {
        lines.push(`#### Request #${i + 1} - ${issue.source || 'request'}`);
        const method = issue.method || 'GET';
        lines.push(`- **Request**: \`${method} ${issue.url || '(unknown URL)'}\``);
        if (Number.isFinite(issue.status) && issue.status > 0) {
          const suffix = issue.statusText ? ` ${issue.statusText}` : '';
          lines.push(`- **Status**: \`${issue.status}${suffix}\``);
        }
        if (issue.error) lines.push(`- **Error**: \`${inlineText(issue.error)}\``);
        pushIssueContext(lines, issue, steps);
        lines.push('');
      });
    }
  }

  function pushStepsTable(lines, steps) {
    if (steps.length === 0) return;
    lines.push('## Recorded Steps');
    lines.push('');
    lines.push('| # | Type | Description |');
    lines.push('|---|------|-------------|');
    steps.forEach((s, i) => {
      const desc = describeStep(s, { includeNote: true }).replace(/\|/g, '\\|');
      lines.push(`| ${i + 1} | ${s.type} | \`${desc}\` |`);
    });
    lines.push('');
  }

  function buildReport(opts) {
    opts = opts || {};
    const steps = opts.steps || [];
    const diagnostics = opts.recordingDiagnostics;
    const annotations = getAnnotated(steps);
    const counts = diagnosticsCounts(diagnostics);
    const status = annotations.length > 0 || counts.total > 0 ? 'BUGS REPORTED' : 'NO ISSUES';
    const lines = [];
    const suiteName = opts.suiteName || 'recorded flow';

    lines.push(`# Bug Report: ${suiteName}`);
    lines.push('');
    lines.push(`**Status**: ${status}`);
    lines.push(`**Recorded steps**: ${steps.length}`);
    lines.push(`**Annotated bugs**: ${annotations.length}`);
    lines.push(`**Captured issues**: ${counts.consoleCount} console, ${counts.pageCount} runtime, ${counts.networkCount} network`);
    lines.push(`**Base URL**: ${opts.baseUrl || '(none)'}`);
    lines.push(`**Captured at**: ${new Date().toISOString()}`);
    lines.push('');
    lines.push('> Captured by Auto-Test Recorder Chrome Extension. Includes recorded interactions, bug notes, and console/network errors observed during testing.');
    lines.push('');

    if (opts.summary && String(opts.summary).trim()) {
      lines.push('## Summary');
      lines.push('');
      lines.push(String(opts.summary).trim());
      lines.push('');
    }

    pushAnnotations(lines, steps);
    pushRecordingIssues(lines, diagnostics, steps);
    pushStepsTable(lines, steps);

    return lines.join('\n');
  }

  function buildCombinedReport(sessions) {
    const lines = [];
    lines.push('# Combined Bug Report');
    lines.push('');
    lines.push(`**Sessions**: ${sessions.length}`);
    lines.push(`**Generated**: ${new Date().toISOString()}`);
    lines.push('');
    lines.push('---');
    lines.push('');
    sessions.forEach((session, i) => {
      lines.push(`<!-- session ${i + 1} of ${sessions.length}: ${session.name} -->`);
      lines.push('');
      lines.push(buildReport({
        suiteName: session.name,
        steps: session.steps || [],
        recordingDiagnostics: session.recordingDiagnostics,
        baseUrl: session.baseUrl,
        summary: session.summary,
      }));
      lines.push('');
      lines.push('---');
      lines.push('');
    });
    return lines.join('\n');
  }

  root.AutoTestReport = {
    locatorLabel,
    describeStep,
    createEmptyDiagnostics,
    diagnosticsCounts,
    buildReport,
    buildCombinedReport,
  };
})(typeof self !== 'undefined' ? self : globalThis);

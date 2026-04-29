import {
  buildBugReport,
  createEmptyDiagnostics,
  describeStep as describeRecordedStep,
  diagnosticsCounts,
  locatorLabel,
} from './report-utils.js';

const wv = document.getElementById('wv');
const urlInput = document.getElementById('url');
const urlForm = document.getElementById('url-form');
const btnBack = document.getElementById('btn-back');
const btnForward = document.getElementById('btn-forward');
const btnReload = document.getElementById('btn-reload');
const btnGo = document.getElementById('btn-go');
const btnRecord = document.getElementById('btn-record');
const btnStop = document.getElementById('btn-stop');
const btnReplay = document.getElementById('btn-replay');
const btnCommentElement = document.getElementById('btn-comment-element');
const btnClear = document.getElementById('btn-clear');
const btnExportJson = document.getElementById('btn-export-json');
const btnOpenJson = document.getElementById('btn-open-json');
const btnExportReport = document.getElementById('btn-export-report');
const fileInput = document.getElementById('file-input');
const summaryInput = document.getElementById('summary-input');
const speedSel = document.getElementById('speed');
const autoWaitToggle = document.getElementById('auto-wait');
const autoWaitSec = document.getElementById('auto-wait-sec');
const statusEl = document.getElementById('status');
const stepList = document.getElementById('step-list');
const stepCount = document.getElementById('step-count');
const codeArea = document.getElementById('code');
const diagramEl = document.getElementById('diagram');
const tabs = document.querySelectorAll('.tab');
const logListEl = document.getElementById('log-list');
const btnLogClear = document.getElementById('btn-log-clear');
const commentPromptEl = document.getElementById('comment-prompt');
const commentPromptTargetEl = document.getElementById('comment-prompt-target');
const commentPromptInput = document.getElementById('comment-prompt-input');
const btnCommentSave = document.getElementById('btn-comment-save');
const btnCommentSkip = document.getElementById('btn-comment-skip');
const btnPreviewReport = document.getElementById('btn-preview-report');
const reportModal = document.getElementById('report-modal');
const reportPreview = document.getElementById('report-preview');
const reportPreviewMeta = document.getElementById('report-preview-meta');
const btnReportCopy = document.getElementById('btn-report-copy');
const btnReportDownload = document.getElementById('btn-report-download');
const btnSessions = document.getElementById('btn-sessions');
const sessionsModal = document.getElementById('sessions-modal');
const sessionsListEl = document.getElementById('sessions-list');
const sessionsEmptyEl = document.getElementById('sessions-empty');
const settingNewPerRecording = document.getElementById('setting-new-per-recording');
const btnSessionNew = document.getElementById('btn-session-new');
const btnSessionSaveNow = document.getElementById('btn-session-save-now');
const btnSessionExportCombined = document.getElementById('btn-session-export-combined');

let pendingPickTarget = null;

if (window.mermaid) {
  window.mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose' });
}

const state = {
  recording: false,
  replaying: false,
  pickingCommentTarget: false,
  pendingCommentText: '',
  steps: [],
  summary: '',
  framework: 'playwright',
  baseUrl: 'https://example.com',
  stepCounter: 0,
  currentReplayStepIndex: null,
  currentDiagnostics: createEmptyDiagnostics(),
  currentDiagnosticKeys: new Set(),
  recordingDiagnostics: createEmptyDiagnostics(),
  recordingDiagnosticKeys: new Set(),
  lastReplay: null, // { startedAt, totalMs, framework, diagnostics, results: [{index, stepId, type, status, durationMs, error?}] }
  sessions: [], // saved snapshots: [{ id, name, createdAt, summary, steps, baseUrl, recordingDiagnostics, lastReplay }]
  activeSessionId: null,
  newReportPerRecording: true,
};

const MAX_RUNTIME_ISSUES = 100;
const CONSOLE_LEVELS = ['log', 'info', 'warning', 'error'];

function getStepDescription(step, options) {
  return describeRecordedStep(step, options);
}

function activeReplayFramework() {
  return state.framework === 'mermaid' ? 'playwright' : state.framework;
}

function commentCodeLine(step, indent) {
  const target = step.locator ? ` on ${locatorLabel(step.locator)}` : '';
  const note = String(step.note || '').replace(/\r?\n/g, ' ').trim();
  return `${indent}// Comment${target}: ${note}`;
}

// ---------- Locator selection (mirrors src/locator.ts priority) ----------
function pickLocator(c) {
  if (c.attrs && c.attrs['data-testid']) return { strategy: 'testId', value: c.attrs['data-testid'] };
  if (c.attrs && c.attrs['aria-label']) return { strategy: 'ariaLabel', value: c.attrs['aria-label'] };
  if (c.attrs && c.attrs.name) return { strategy: 'name', value: c.attrs.name };
  if (c.attrs && c.attrs.id) return { strategy: 'id', value: c.attrs.id };
  if (c.attrs && c.attrs.placeholder) return { strategy: 'placeholder', value: c.attrs.placeholder };
  if (c.attrs && c.attrs.role) return { strategy: 'role', value: c.attrs.role };
  if (c.text) return { strategy: 'text', value: c.text };
  if (c.cssSelector) return { strategy: 'css', value: c.cssSelector };
  return { strategy: 'css', value: c.tag || '*' };
}

// ---------- Convert locator to CSS for replay ----------
function locatorToCss(loc) {
  switch (loc.strategy) {
    case 'testId': return `[data-testid="${escAttr(loc.value)}"]`;
    case 'ariaLabel': return `[aria-label="${escAttr(loc.value)}"]`;
    case 'name': return `[name="${escAttr(loc.value)}"]`;
    case 'id': return `#${cssIdent(loc.value)}`;
    case 'placeholder': return `[placeholder="${escAttr(loc.value)}"]`;
    case 'role': return `[role="${escAttr(loc.value)}"]`;
    case 'css': return loc.value;
    case 'text': return null; // text needs XPath fallback
    default: return loc.value;
  }
}
function escAttr(s) { return String(s).replace(/"/g, '\\"'); }
function cssIdent(s) { return String(s).replace(/([^a-zA-Z0-9_-])/g, '\\$1'); }

// ---------- Locator to Playwright selector ----------
function locatorToPwSelector(loc) {
  switch (loc.strategy) {
    case 'testId': return `[data-testid="${escAttr(loc.value)}"]`;
    case 'ariaLabel': return `[aria-label="${escAttr(loc.value)}"]`;
    case 'name': return `[name="${escAttr(loc.value)}"]`;
    case 'id': return `#${loc.value}`;
    case 'placeholder': return `[placeholder="${escAttr(loc.value)}"]`;
    case 'role': return `[role="${escAttr(loc.value)}"]`;
    case 'text': return `text=${loc.value}`;
    case 'css': return loc.value;
    default: return loc.value;
  }
}

// ---------- Code generation ----------
function genPlaywright(steps, name) {
  const lines = [];
  lines.push(`import { test, expect } from '@playwright/test';`);
  lines.push(`test(${JSON.stringify(name)}, async ({ page }) => {`);
  for (const s of steps) {
    if (s.type === 'navigate') lines.push(`  await page.goto(${JSON.stringify(s.url)});`);
    else if (s.type === 'click') lines.push(`  await page.click('${locatorToPwSelector(s.locator)}');`);
    else if (s.type === 'fill') lines.push(`  await page.fill('${locatorToPwSelector(s.locator)}', ${JSON.stringify(s.text || '')});`);
    else if (s.type === 'select') lines.push(`  await page.selectOption('${locatorToPwSelector(s.locator)}', ${JSON.stringify(s.selectValue || '')});`);
    else if (s.type === 'check') lines.push(`  await page.check('${locatorToPwSelector(s.locator)}');`);
    else if (s.type === 'uncheck') lines.push(`  await page.uncheck('${locatorToPwSelector(s.locator)}');`);
    else if (s.type === 'press') lines.push(`  await page.press('${locatorToPwSelector(s.locator)}', ${JSON.stringify(s.key || 'Enter')});`);
    else if (s.type === 'assertVisible') lines.push(`  await expect(page.locator('${locatorToPwSelector(s.locator)}')).toBeVisible();`);
    else if (s.type === 'comment') lines.push(commentCodeLine(s, '  '));
    else if (s.type === 'wait') lines.push(`  await page.waitForTimeout(${s.timeoutMs || 500});`);
  }
  lines.push(`});`);
  return lines.join('\n');
}

function genCypress(steps, name) {
  const lines = [];
  lines.push(`describe(${JSON.stringify(name)}, () => {`);
  lines.push(`  it('runs recorded steps', () => {`);
  for (const s of steps) {
    if (s.type === 'navigate') lines.push(`    cy.visit(${JSON.stringify(s.url)});`);
    else if (s.type === 'click') lines.push(`    cy.get('${locatorToPwSelector(s.locator)}').click();`);
    else if (s.type === 'fill') lines.push(`    cy.get('${locatorToPwSelector(s.locator)}').type(${JSON.stringify(s.text || '')});`);
    else if (s.type === 'select') lines.push(`    cy.get('${locatorToPwSelector(s.locator)}').select(${JSON.stringify(s.selectValue || '')});`);
    else if (s.type === 'check') lines.push(`    cy.get('${locatorToPwSelector(s.locator)}').check();`);
    else if (s.type === 'uncheck') lines.push(`    cy.get('${locatorToPwSelector(s.locator)}').uncheck();`);
    else if (s.type === 'press') lines.push(`    cy.get('${locatorToPwSelector(s.locator)}').type('{${String(s.key).toLowerCase()}}');`);
    else if (s.type === 'comment') lines.push(commentCodeLine(s, '    '));
    else if (s.type === 'wait') lines.push(`    cy.wait(${s.timeoutMs || 500});`);
  }
  lines.push(`  });`);
  lines.push(`});`);
  return lines.join('\n');
}

function genPuppeteer(steps, name) {
  const lines = [];
  lines.push(`// ${name}`);
  lines.push(`import puppeteer from 'puppeteer';`);
  lines.push(`const browser = await puppeteer.launch();`);
  lines.push(`const page = await browser.newPage();`);
  for (const s of steps) {
    if (s.type === 'navigate') lines.push(`await page.goto(${JSON.stringify(s.url)});`);
    else if (s.type === 'click') lines.push(`await page.click('${locatorToPwSelector(s.locator)}');`);
    else if (s.type === 'fill') lines.push(`await page.type('${locatorToPwSelector(s.locator)}', ${JSON.stringify(s.text || '')});`);
    else if (s.type === 'comment') lines.push(commentCodeLine(s, ''));
    else if (s.type === 'wait') lines.push(`await new Promise(r => setTimeout(r, ${s.timeoutMs || 500}));`);
  }
  lines.push(`await browser.close();`);
  return lines.join('\n');
}

function generate(steps, framework) {
  const name = 'recorded flow';
  if (framework === 'playwright') return genPlaywright(steps, name);
  if (framework === 'cypress') return genCypress(steps, name);
  if (framework === 'puppeteer') return genPuppeteer(steps, name);
  if (framework === 'mermaid') return genMermaid(steps, name);
  return '';
}

// ---------- Mermaid diagram ----------
// Keep in sync with src/flowchart.ts sanitizeMermaidLabel / getStepLabel.
function sanitizeMermaidLabel(s) {
  return String(s).replace(/[\[\]\(\)\{\}"<>|;`]/g, ' ');
}

function stepLabel(step) {
  const type = step.type.charAt(0).toUpperCase() + step.type.slice(1);
  let detail = '';
  if (step.locator) detail = `: ${step.locator.value}`;
  else if (step.url) detail = `: ${step.url}`;
  else if (step.type === 'wait') detail = `: ${step.timeoutMs || 0}ms`;
  else if (step.type === 'comment') detail = step.note ? `: ${step.note}` : ': note';
  let value = '';
  if (step.text) value = ` '${step.text}'`;
  else if (step.selectValue) value = ` '${step.selectValue}'`;
  else if (step.key) value = ` [${step.key}]`;
  else if (step.type === 'comment' && step.locator) value = ` [${locatorLabel(step.locator)}]`;
  return sanitizeMermaidLabel(`${type}${detail}${value}`);
}

function stepShape(step) {
  switch (step.type) {
    case 'navigate': return ['[[', ']]'];
    case 'wait': return ['((', '))'];
    case 'assertText':
    case 'assertVisible': return ['{', '}'];
    case 'comment': return ['[/', '/]'];
    default: return ['[', ']'];
  }
}

function genMermaid(steps, name) {
  const lines = ['graph TD'];
  lines.push(`  Start([Start: ${sanitizeMermaidLabel(name)}])`);
  let prev = 'Start';
  steps.forEach((s, i) => {
    const id = `step_${i}`;
    const [o, c] = stepShape(s);
    lines.push(`  ${id}${o}${stepLabel(s)}${c}`);
    lines.push(`  ${prev} --> ${id}`);
    prev = id;
  });
  lines.push('  End([End])');
  lines.push(`  ${prev} --> End`);
  return lines.join('\n');
}

let mermaidRenderSeq = 0;
async function renderMermaid() {
  if (!window.mermaid || !diagramEl) return;
  const src = genMermaid(state.steps, 'recorded flow');
  try {
    const id = `mermaid_${++mermaidRenderSeq}`;
    const { svg } = await window.mermaid.render(id, src);
    diagramEl.innerHTML = svg;
  } catch (err) {
    diagramEl.textContent = 'Diagram error: ' + err.message;
  }
}

// ---------- Rendering ----------
function render() {
  stepCount.textContent = `(${state.steps.length})`;
  stepList.innerHTML = '';
  syncCommentButton();
  syncExportReportButton();

  const addInsertSlot = (index) => {
    const slot = document.createElement('li');
    slot.className = 'insert-slot';
    slot.style.listStyle = 'none';
    slot.style.background = 'transparent';
    slot.style.border = 'none';
    slot.style.padding = '0';
    slot.style.margin = '0';
    const btn = document.createElement('button');
    btn.textContent = '+';
    btn.title = 'Insert Wait step here';
    btn.onclick = () => insertWaitAt(index);
    slot.appendChild(btn);
    stepList.appendChild(slot);
  };

  if (state.steps.length > 0) addInsertSlot(0);

  state.steps.forEach((s, i) => {
    const li = document.createElement('li');
    li.dataset.idx = String(i);
    if (s.type === 'wait') li.classList.add('is-wait');
    if (s.type === 'comment') li.classList.add('is-comment');
    const idx = document.createElement('span');
    idx.className = 'idx';
    idx.textContent = String(i + 1);
    const type = document.createElement('span');
    type.className = 'type';
    type.textContent = s.type;
    const target = document.createElement('span');
    target.className = 'target';
    if (s.type === 'wait') {
      const secInput = document.createElement('input');
      secInput.type = 'number';
      secInput.className = 'wait-sec';
      secInput.min = '0';
      secInput.step = '0.5';
      secInput.value = String((s.timeoutMs || 0) / 1000);
      secInput.title = 'wait seconds';
      secInput.addEventListener('change', () => {
        const v = parseFloat(secInput.value);
        s.timeoutMs = Number.isFinite(v) && v >= 0 ? Math.round(v * 1000) : 0;
        updateCode();
      });
      const unit = document.createElement('span');
      unit.textContent = ' seconds';
      target.appendChild(secInput);
      target.appendChild(unit);
    } else {
      const main = document.createElement('span');
      main.className = 'main';
      main.textContent = getStepDescription(s);
      target.appendChild(main);
      if (s.note && s.type !== 'comment') {
        const note = document.createElement('span');
        note.className = 'note';
        note.textContent = s.note;
        target.appendChild(note);
      }
    }
    const edit = document.createElement('span');
    edit.className = 'edit-note';
    edit.textContent = '✎';
    edit.title = s.note ? 'edit note' : 'add note';
    edit.onclick = () => editStepNoteAt(i);
    const dup = document.createElement('span');
    dup.className = 'dup';
    dup.textContent = '⎘';
    dup.title = 'duplicate';
    dup.onclick = () => duplicateAt(i);
    const rm = document.createElement('span');
    rm.className = 'remove';
    rm.textContent = '×';
    rm.title = 'remove';
    rm.onclick = () => {
      state.steps.splice(i, 1);
      render();
      updateCode();
    };
    li.appendChild(idx);
    li.appendChild(type);
    li.appendChild(target);
    li.appendChild(edit);
    li.appendChild(dup);
    li.appendChild(rm);
    stepList.appendChild(li);

    addInsertSlot(i + 1);
  });
}

function insertWaitAt(index) {
  const raw = window.prompt('Wait duration in ms', '500');
  if (raw === null) return;
  const ms = parseInt(raw, 10);
  if (!Number.isFinite(ms) || ms < 0) return;
  state.stepCounter++;
  const step = {
    id: `step_${Date.now()}_${state.stepCounter}`,
    type: 'wait',
    timeoutMs: ms,
  };
  state.steps.splice(index, 0, step);
  render();
  updateCode();
}

function duplicateAt(index) {
  const src = state.steps[index];
  if (!src) return;
  state.stepCounter++;
  const copy = { ...src, id: `step_${Date.now()}_${state.stepCounter}` };
  state.steps.splice(index + 1, 0, copy);
  render();
  updateCode();
}

function editStepNoteAt(index) {
  const step = state.steps[index];
  if (!step) return;
  const current = step.note || '';
  const raw = window.prompt('Step note / comment', current);
  if (raw === null) return;
  step.note = raw.trim();
  if (!step.note) delete step.note;
  render();
  updateCode();
}

function syncCommentButton() {
  if (!btnCommentElement) return;
  btnCommentElement.disabled = state.replaying;
  btnCommentElement.textContent = state.pickingCommentTarget ? '■ Stop Commenting' : 'Comment Element';
  btnCommentElement.classList.toggle('primary', state.pickingCommentTarget);
}

function syncExportReportButton() {
  // Allow export whenever there's recorded content. A replay produces a
  // richer report (failures, diagnostics), but QA testers commonly just want
  // to record + comment + export — so enable as soon as there is anything to
  // hand off to a dev or AI.
  const hasContent =
    state.steps.length > 0 ||
    (state.summary && state.summary.trim().length > 0) ||
    !!state.lastReplay ||
    diagnosticsCounts(state.recordingDiagnostics).total > 0;
  if (btnExportReport) btnExportReport.disabled = !hasContent;
  if (btnPreviewReport) btnPreviewReport.disabled = !hasContent;
}

function updateCode() {
  if (state.framework === 'mermaid') {
    codeArea.hidden = true;
    diagramEl.hidden = false;
    renderMermaid();
  } else {
    diagramEl.hidden = true;
    codeArea.hidden = false;
    codeArea.value = generate(state.steps, state.framework);
  }
}

function setStatus(kind, text) {
  statusEl.className = `status ${kind}`;
  statusEl.textContent = text;
}

function beginElementComment() {
  if (state.pickingCommentTarget) {
    cancelElementComment();
    return;
  }
  state.pickingCommentTarget = true;
  state.pendingCommentText = '';
  syncCommentButton();
  try {
    wv.send('inspector:pick-mode', true);
  } catch {}
  setStatus('recording', 'Click an element to comment. Click the button again to stop.');
  if (wv && wv.focus) wv.focus();
}

function resumePickMode() {
  if (!state.pickingCommentTarget) return;
  try {
    wv.send('inspector:pick-mode', true);
  } catch {}
  setStatus('recording', 'Click an element to comment. Click the button again to stop.');
  if (wv && wv.focus) wv.focus();
}

function cancelElementComment() {
  if (!state.pickingCommentTarget) return;
  try {
    wv.send('inspector:pick-mode', false);
  } catch {}
  finishElementComment();
  logEntry('info', 'Element comment selection cancelled');
}

function finishElementComment() {
  state.pickingCommentTarget = false;
  state.pendingCommentText = '';
  hideCommentPrompt();
  syncCommentButton();
  if (state.recording) setStatus('recording', 'Recording…');
  else if (state.replaying) setStatus('replaying', 'Replaying…');
  else setStatus('idle', 'Idle');
}

function addCommentStep(target, note) {
  const locator = target ? pickLocator(target) : undefined;
  let pageUrl = '';
  try {
    if (wv && typeof wv.getURL === 'function') pageUrl = wv.getURL() || '';
  } catch {}
  const step = { type: 'comment', locator, note };
  if (pageUrl) step.pageUrl = pageUrl;
  pushStep(step, { allowAutoWait: false });
  logEntry('info', `Saved note for ${locator ? locatorLabel(locator) : 'page'}: ${note}`);
}

function showCommentPrompt(target) {
  pendingPickTarget = target || null;
  if (!commentPromptEl) return;
  const locator = target ? pickLocator(target) : null;
  commentPromptTargetEl.textContent = locator ? locatorLabel(locator) : 'selected element';
  commentPromptInput.value = '';
  commentPromptEl.hidden = false;
  setStatus('recording', 'Type a comment for the selected element');
  commentPromptInput.focus();
}

function hideCommentPrompt() {
  pendingPickTarget = null;
  if (commentPromptEl) commentPromptEl.hidden = true;
  commentPromptInput.value = '';
}

function commitCommentPrompt() {
  const note = commentPromptInput.value.trim();
  const target = pendingPickTarget;
  hideCommentPrompt();
  if (note) addCommentStep(target, note);
  // Like Record: keep pick mode active until user toggles it off.
  if (state.pickingCommentTarget) resumePickMode();
  else finishElementComment();
}

function skipCommentPrompt() {
  hideCommentPrompt();
  if (state.pickingCommentTarget) resumePickMode();
  else finishElementComment();
}

if (btnCommentSave) btnCommentSave.addEventListener('click', commitCommentPrompt);
if (btnCommentSkip) btnCommentSkip.addEventListener('click', skipCommentPrompt);
if (commentPromptInput) {
  commentPromptInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      commitCommentPrompt();
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      skipCommentPrompt();
    }
  });
}

function diagnosticSignature(kind, issue) {
  return [
    kind,
    issue.stepIndex ?? '',
    issue.level ?? '',
    issue.source ?? '',
    issue.sourceId ?? '',
    issue.line ?? '',
    issue.method ?? '',
    issue.url ?? '',
    issue.status ?? '',
    issue.message ?? '',
    issue.error ?? '',
    issue.resourceType ?? '',
  ].join('|');
}

function pushDiagnosticInto(kind, issue, opts) {
  const { bag, keys, stepIndex, mode } = opts;
  const list = bag[kind];
  if (!Array.isArray(list) || list.length >= MAX_RUNTIME_ISSUES) return;
  const enriched = { ...issue, stepIndex: stepIndex ?? null, capturedAt: new Date().toISOString() };
  const key = diagnosticSignature(kind, enriched);
  if (keys.has(key)) return;
  keys.add(key);
  list.push(enriched);
  const where = stepIndex != null ? `step ${stepIndex + 1}` : (mode === 'recording' ? 'recording' : 'replay');
  if (kind === 'network') {
    const method = enriched.method || 'GET';
    const detail = enriched.status ? `${enriched.status}` : enriched.error || 'request failed';
    logEntry('err', `Network issue near ${where}: ${method} ${enriched.url || '(unknown)'} -> ${detail}`);
    return;
  }
  if (kind === 'console') {
    logEntry('err', `Console ${enriched.level} near ${where}: ${enriched.message}`);
    return;
  }
  logEntry('err', `Runtime error near ${where}: ${enriched.message}`);
}

function handleRuntimeIssue(kind, payload) {
  if (kind !== 'console' && kind !== 'network' && kind !== 'page') return;
  if (state.recording) {
    pushDiagnosticInto(kind, payload, {
      bag: state.recordingDiagnostics,
      keys: state.recordingDiagnosticKeys,
      stepIndex: state.steps.length > 0 ? state.steps.length - 1 : null,
      mode: 'recording',
    });
    syncExportReportButton();
  }
  if (state.replaying) {
    pushDiagnosticInto(kind, payload, {
      bag: state.currentDiagnostics,
      keys: state.currentDiagnosticKeys,
      stepIndex: Number.isInteger(state.currentReplayStepIndex) ? state.currentReplayStepIndex : null,
      mode: 'replay',
    });
  }
}

// ---------- Replay log ----------
const LOG_MAX = 500;
const LOG_ICONS = { info: '•', run: '▶', ok: '✓', err: '✗' };

function logEntry(kind, msg) {
  if (!logListEl) return;
  const li = document.createElement('li');
  li.className = kind;
  const now = new Date();
  const ts = now.toTimeString().slice(0, 8) + '.' + String(now.getMilliseconds()).padStart(3, '0');
  const tsEl = document.createElement('span');
  tsEl.className = 'ts';
  tsEl.textContent = ts;
  const iconEl = document.createElement('span');
  iconEl.className = 'icon';
  iconEl.textContent = LOG_ICONS[kind] || '·';
  const msgEl = document.createElement('span');
  msgEl.className = 'msg';
  msgEl.textContent = msg;
  li.appendChild(tsEl);
  li.appendChild(iconEl);
  li.appendChild(msgEl);
  logListEl.appendChild(li);
  while (logListEl.children.length > LOG_MAX) logListEl.removeChild(logListEl.firstChild);
  logListEl.scrollTop = logListEl.scrollHeight;
}

function clearLog() {
  if (logListEl) logListEl.innerHTML = '';
}

if (btnLogClear) btnLogClear.addEventListener('click', clearLog);

function setRecording(on) {
  state.recording = on;
  btnRecord.disabled = on;
  btnStop.disabled = !on;
  btnReplay.disabled = on;
  wv.send('recorder:set-enabled', on);
  syncCommentButton();
  setStatus(on ? 'recording' : 'idle', on ? 'Recording…' : 'Idle');
}

// ---------- Event wiring ----------
btnRecord.addEventListener('click', () => {
  // When the "new report per recording" setting is on, archive the current
  // work into the sessions list and start fresh on each Record click. With
  // the setting off, recordings accumulate into one growing report.
  if (state.newReportPerRecording && hasContent()) {
    saveCurrentAsSession(false);
    clearCurrentState();
    render();
    updateCode();
    logEntry('info', 'Auto-archived previous session — starting new recording');
  }
  setRecording(true);
  // Return keyboard focus to the webview so the next keystroke lands in the
  // page and is captured by the preload — otherwise typing hits the Electron
  // chrome and the text appears to float "over the website."
  if (wv && wv.focus) wv.focus();
});
btnStop.addEventListener('click', () => {
  cancelElementComment();
  setRecording(false);
  // Auto-save on Stop so the recording becomes a retrievable session.
  if (hasContent()) {
    const session = saveCurrentAsSession(false);
    if (session) {
      logEntry('info', `Saved session on stop: ${session.name}`);
      renderSessionsList();
    }
  }
});
if (btnCommentElement) btnCommentElement.addEventListener('click', beginElementComment);
if (summaryInput) {
  summaryInput.addEventListener('input', () => {
    state.summary = summaryInput.value;
    persist();
  });
}

btnClear.addEventListener('click', () => {
  cancelElementComment();
  state.steps = [];
  state.stepCounter = 0;
  state.summary = '';
  state.lastReplay = null;
  state.recordingDiagnostics = createEmptyDiagnostics();
  state.recordingDiagnosticKeys = new Set();
  if (summaryInput) summaryInput.value = '';
  render();
  updateCode();
});

if (btnExportJson) {
  btnExportJson.addEventListener('click', () => {
    if (state.steps.length === 0 && !state.summary.trim()) {
      alert('No steps or summary to export.');
      return;
    }
    const suite = {
      name: 'recorded flow',
      baseUrl: state.baseUrl,
      summary: state.summary,
      steps: state.steps,
      createdAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(suite, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `suite_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

btnReplay.addEventListener('click', () => {
  cancelElementComment();
  replay();
});

urlForm.addEventListener('submit', (e) => {
  e.preventDefault();
  navigateTo(urlInput.value.trim());
});
btnGo.addEventListener('click', () => navigateTo(urlInput.value.trim()));
btnBack.addEventListener('click', () => wv.canGoBack() && wv.goBack());
btnForward.addEventListener('click', () => wv.canGoForward() && wv.goForward());
btnReload.addEventListener('click', () => wv.reload());

const btnDevtools = document.getElementById('btn-devtools');
function toggleWebviewDevTools() {
  if (!wv) return;
  try {
    if (typeof wv.isDevToolsOpened === 'function' && wv.isDevToolsOpened()) {
      wv.closeDevTools();
    } else if (typeof wv.openDevTools === 'function') {
      wv.openDevTools();
    }
  } catch (e) {
    logEntry('err', `DevTools toggle failed: ${(e && e.message) || e}`);
  }
}
if (btnDevtools) btnDevtools.addEventListener('click', toggleWebviewDevTools);
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'F12') {
    ev.preventDefault();
    toggleWebviewDevTools();
  }
});

tabs.forEach((t) => {
  t.addEventListener('click', () => {
    tabs.forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    state.framework = t.dataset.fw;
    updateCode();
  });
});

function navigateTo(url) {
  if (!url) return;
  if (!/^https?:\/\//.test(url)) url = 'https://' + url;
  urlInput.value = url;
  state.baseUrl = url;
  wv.loadURL(url);
  if (state.recording) {
    pushStep({ type: 'navigate', url });
  }
}

function sameLocator(a, b) {
  return a && b && a.strategy === b.strategy && a.value === b.value;
}

function pushStep(step, options = {}) {
  const allowAutoWait = options.allowAutoWait !== false;

  // Carry-forward: the typical pattern "click a field, then type into it"
  // means both events target the same control. Reuse the click's locator
  // for the fill so keystroke-per-event captures all collapse to one step.
  if (step.type === 'fill' && state.steps.length > 0) {
    let prevIdx = state.steps.length - 1;
    if (state.steps[prevIdx].type === 'wait') prevIdx--;
    const prev = prevIdx >= 0 ? state.steps[prevIdx] : null;
    if (prev && (prev.type === 'click' || prev.type === 'fill') && prev.locator) {
      step.locator = prev.locator;
    }
  }

  // Collapse adjacent fills on the same target — each keystroke fires its own
  // input event, but the user's mental model is one "fill" action with the
  // final text. Skip over a trailing auto-wait to find the previous fill.
  if (step.type === 'fill' && state.steps.length > 0) {
    let prevIdx = state.steps.length - 1;
    if (state.steps[prevIdx].type === 'wait') prevIdx--;
    const prev = prevIdx >= 0 ? state.steps[prevIdx] : null;
    if (prev && prev.type === 'fill' && sameLocator(prev.locator, step.locator)) {
      prev.text = step.text;
      render();
      updateCode();
      return;
    }
  }

  state.stepCounter++;
  step.id = `step_${Date.now()}_${state.stepCounter}`;
  state.steps.push(step);

  // Auto-wait: after every action (not after a wait), append a configurable
  // wait so replay has breathing room between steps. Users can tweak the
  // seconds inline or delete the wait step from the list.
  if (allowAutoWait && autoWaitToggle && autoWaitToggle.checked && step.type !== 'wait' && step.type !== 'comment') {
    const secs = parseFloat(autoWaitSec?.value);
    const ms = Number.isFinite(secs) && secs > 0 ? Math.round(secs * 1000) : 0;
    if (ms > 0) {
      state.stepCounter++;
      state.steps.push({
        id: `step_${Date.now()}_${state.stepCounter}`,
        type: 'wait',
        timeoutMs: ms,
      });
    }
  }

  render();
  updateCode();
}

// ---------- Webview messages ----------
wv.addEventListener('dom-ready', () => {
  wv.send('recorder:set-enabled', state.recording);
  if (state.pickingCommentTarget) wv.send('inspector:pick-mode', true);
});

wv.addEventListener('did-navigate', (e) => {
  urlInput.value = e.url;
});
wv.addEventListener('did-navigate-in-page', (e) => {
  urlInput.value = e.url;
});

wv.addEventListener('console-message', (ev) => {
  const level = CONSOLE_LEVELS[ev.level] || 'log';
  if (level !== 'warning' && level !== 'error') return;
  handleRuntimeIssue('console', {
    level,
    message: ev.message,
    sourceId: ev.sourceId,
    line: ev.line,
  });
});

wv.addEventListener('did-fail-load', (ev) => {
  handleRuntimeIssue('network', {
    source: 'navigation',
    url: ev.validatedURL || ev.url || '',
    error: `${ev.errorCode}: ${ev.errorDescription}`,
  });
});

wv.addEventListener('ipc-message', (ev) => {
  if (ev.channel === 'inspector:pick-cancelled') {
    finishElementComment();
    logEntry('info', 'Element comment selection cancelled');
    return;
  }
  if (ev.channel === 'inspector:pick-element') {
    const raw = ev.args[0];
    showCommentPrompt(raw?.target);
    return;
  }
  if (ev.channel === 'telemetry:issue') {
    const raw = ev.args[0] || {};
    handleRuntimeIssue(raw.kind, raw.payload || {});
    return;
  }
  if (ev.channel !== 'recorder:step') return;
  if (!state.recording) return;
  const raw = ev.args[0];
  // Pipeline-level guard (bug06): a `fill` step whose locator is derived from
  // the just-typed text is circular — replay would search for the post-fill
  // text in the pre-fill DOM and always miss. Strip `text` from the candidate
  // for fill events so pickLocator can never choose `strategy: "text"` here.
  if (raw.type === 'fill' && raw.target) {
    raw.target = { ...raw.target, text: undefined };
  }
  const locator = pickLocator(raw.target || { attrs: {} });
  const step = { type: raw.type, locator };
  if (raw.text !== undefined) step.text = raw.text;
  if (raw.selectValue !== undefined) step.selectValue = raw.selectValue;
  if (raw.key !== undefined) step.key = raw.key;
  pushStep(step);
});

// ---------- Replay ----------
async function replay() {
  if (state.replaying || state.steps.length === 0) return;
  state.replaying = true;
  state.currentReplayStepIndex = null;
  state.currentDiagnostics = createEmptyDiagnostics();
  state.currentDiagnosticKeys = new Set();
  btnReplay.disabled = true;
  btnRecord.disabled = true;
  syncCommentButton();
  setStatus('replaying', 'Replaying…');

  const delay = parseInt(speedSel.value, 10);
  const lis = stepList.querySelectorAll('li:not(.insert-slot)');

  clearLog();
  logEntry('info', `— Replay started · ${state.steps.length} step(s) · speed=${delay}ms —`);
  const startedAt = performance.now();
  const startedAtIso = new Date().toISOString();
  const results = [];
  let failures = 0;

  for (let i = 0; i < state.steps.length; i++) {
    lis.forEach((el) => el.classList.remove('active'));
    if (lis[i]) {
      lis[i].classList.remove('failed');
      lis[i].classList.add('active');
    }
    const step = state.steps[i];
    const desc = getStepDescription(step);
    state.currentReplayStepIndex = i;
    logEntry('run', `Step ${i + 1}/${state.steps.length}: ${step.type} — ${desc}`);
    const stepStart = performance.now();
    try {
      await runStep(step);
      const ms = Math.round(performance.now() - stepStart);
      logEntry('ok', `Step ${i + 1} ok (${ms}ms)`);
      results.push({ index: i, stepId: step.id, type: step.type, status: 'passed', durationMs: ms });
    } catch (err) {
      failures++;
      if (lis[i]) lis[i].classList.add('failed');
      const ms = Math.round(performance.now() - stepStart);
      const message = (err && err.message) || String(err);
      logEntry('err', `Step ${i + 1} FAILED (${ms}ms): ${message}`);
      console.warn('Replay step failed:', desc, message);
      results.push({ index: i, stepId: step.id, type: step.type, status: 'failed', durationMs: ms, error: message });
    }
    await sleep(delay);
  }

  state.currentReplayStepIndex = null;
  lis.forEach((el) => el.classList.remove('active'));
  const total = Math.round(performance.now() - startedAt);
  const issueCounts = diagnosticsCounts(state.currentDiagnostics);
  const summary = failures === 0 && issueCounts.total === 0
    ? `— Replay done · all ${state.steps.length} passed · ${total}ms —`
    : `— Replay done · ${state.steps.length - failures} passed · ${failures} failed · ${issueCounts.consoleCount} console · ${issueCounts.pageCount} runtime · ${issueCounts.networkCount} network · ${total}ms —`;
  logEntry(failures === 0 && issueCounts.total === 0 ? 'info' : 'err', summary);
  setStatus(
    'idle',
    failures === 0 && issueCounts.total === 0
      ? 'Replay done'
      : `Replay done (${failures} step fail, ${issueCounts.total} issue)`,
  );
  state.lastReplay = {
    startedAt: startedAtIso,
    totalMs: total,
    framework: activeReplayFramework(),
    suiteName: 'recorded flow',
    baseUrl: state.baseUrl,
    diagnostics: state.currentDiagnostics,
    results,
  };
  if (btnExportReport) btnExportReport.disabled = false;
  state.replaying = false;
  btnReplay.disabled = false;
  btnRecord.disabled = false;
  syncCommentButton();
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * Build a JS expression string that resolves to the target Element (or null).
 * Everything goes through `document.querySelector` except `text`, which walks
 * leaf elements and matches on trimmed textContent — no XPath, no surprises.
 */
function buildFinderExpr(loc) {
  const css = locatorToCss(loc);
  if (css) return `document.querySelector(${JSON.stringify(css)})`;
  if (loc.strategy === 'text') {
    const target = JSON.stringify(loc.value);
    return `(function(){var t=${target};var all=document.querySelectorAll('a,button,span,div,p,h1,h2,h3,h4,h5,h6,li,td,th,label,strong,em,i,b');for(var i=0;i<all.length;i++){var e=all[i];if(e.children.length===0&&(e.textContent||'').trim()===t)return e;}for(var j=0;j<all.length;j++){var el=all[j];if((el.textContent||'').trim()===t)return el;}return null;})()`;
  }
  return 'null';
}

async function runStep(step) {
  if (step.type === 'comment') return;
  if (step.type === 'wait') {
    await sleep(step.timeoutMs || 500);
    return;
  }
  if (step.type === 'navigate') {
    const p = waitForLoad();
    wv.loadURL(step.url);
    await p;
    return;
  }
  if (!step.locator) return;

  const finder = buildFinderExpr(step.locator);
  const type = step.type;

  // Clicks go through the native Chromium input pipeline via sendInputEvent
  // so the event is `isTrusted=true`. Synthetic MouseEvent.dispatchEvent() is
  // rejected by some React/framework handlers that check for trusted events,
  // which is why a recorded click on a <div>-styled submit button fails on
  // replay but works when clicked manually.
  if (type === 'click') {
    const locateCode = `
      (function(){
        try {
          var el = ${finder};
          if (!el) return null;
          el.scrollIntoView({block:'center', inline:'center'});
          var r = el.getBoundingClientRect();
          var w = window.innerWidth, h = window.innerHeight;
          var x = Math.max(0, Math.min(w - 1, Math.round(r.left + r.width / 2)));
          var y = Math.max(0, Math.min(h - 1, Math.round(r.top + r.height / 2)));
          return { x: x, y: y };
        } catch (e) { return { error: String(e && e.message || e) }; }
      })()
    `;
    const loc = await wv.executeJavaScript(locateCode, true);
    if (!loc) throw new Error('element not found');
    if (loc.error) throw new Error(loc.error);
    // Let scrollIntoView paint before firing the click.
    await sleep(120);
    wv.sendInputEvent({ type: 'mouseDown', x: loc.x, y: loc.y, button: 'left', clickCount: 1 });
    await sleep(30);
    wv.sendInputEvent({ type: 'mouseUp', x: loc.x, y: loc.y, button: 'left', clickCount: 1 });
    return;
  }

  let body = '';
  if (type === 'fill') {
    const v = JSON.stringify(step.text || '');
    // React tracks `.value` via an internal setter — assigning directly is
    // silently ignored for controlled components. Route through the
    // HTMLInputElement / HTMLTextAreaElement prototype setter so React sees
    // the change, then fire an InputEvent (not plain Event) so handlers that
    // inspect `InputEvent.data` still work.
    body = `
      el.focus();
      if ('value' in el) {
        var _proto = (el.tagName === 'TEXTAREA')
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
        var _desc = _proto && Object.getOwnPropertyDescriptor(_proto, 'value');
        if (_desc && _desc.set) _desc.set.call(el, ${v});
        else el.value = ${v};
      } else {
        el.textContent = ${v};
      }
      var _ie = (typeof InputEvent === 'function')
        ? new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: ${v} })
        : new Event('input', { bubbles: true });
      el.dispatchEvent(_ie);
      el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    `;
  } else if (type === 'select') {
    const v = JSON.stringify(step.selectValue || '');
    body = `el.value=${v};el.dispatchEvent(new Event('change',{bubbles:true}));`;
  } else if (type === 'check' || type === 'uncheck') {
    body = `el.checked=${type === 'check'};el.dispatchEvent(new Event('change',{bubbles:true}));`;
  } else if (type === 'press') {
    const k = JSON.stringify(step.key || 'Enter');
    body = `
      el.focus();
      var _ko = {key:${k},bubbles:true,cancelable:true,composed:true};
      el.dispatchEvent(new KeyboardEvent('keydown', _ko));
      el.dispatchEvent(new KeyboardEvent('keypress', _ko));
      el.dispatchEvent(new KeyboardEvent('keyup', _ko));
      // Enter inside a form input has an implicit submit in browsers but
      // programmatic keydown doesn't trigger defaults — do it ourselves.
      if (${k} === 'Enter' && el.form) {
        if (typeof el.form.requestSubmit === 'function') el.form.requestSubmit();
        else el.form.submit();
      }
    `;
  } else {
    return;
  }

  const code = `(function(){try{var el=${finder};if(!el)return{found:false};${body}return{found:true};}catch(e){return{found:false,error:String(e && e.message || e)};}})()`;
  const result = await wv.executeJavaScript(code, true);
  if (result && result.error) throw new Error(result.error);
  if (result && result.found === false) throw new Error('element not found');
}

function waitForLoad() {
  return new Promise((resolve) => {
    const onLoad = () => {
      wv.removeEventListener('did-finish-load', onLoad);
      resolve();
    };
    wv.addEventListener('did-finish-load', onLoad);
    setTimeout(() => {
      wv.removeEventListener('did-finish-load', onLoad);
      resolve();
    }, 8000);
  });
}

// ---------- Save / Open / Auto-persist ----------
const PERSIST_KEY = 'autoTestRecorder.lastSuite.v1';

function persist() {
  try {
    const payload = {
      name: 'recorded flow',
      baseUrl: state.baseUrl,
      summary: state.summary,
      steps: state.steps,
      stepCounter: state.stepCounter,
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(PERSIST_KEY, JSON.stringify(payload));
  } catch (e) {
    // localStorage can throw on quota exceeded — degrade gracefully.
    console.warn('persist failed:', e && e.message);
  }
}

function validateSuite(suite) {
  if (!suite || typeof suite !== 'object') return 'not an object';
  if (!Array.isArray(suite.steps)) return 'missing steps[]';
  for (const s of suite.steps) {
    if (!s || typeof s !== 'object') return 'step is not an object';
    if (typeof s.type !== 'string') return 'step.type missing';
  }
  return null;
}

function loadSuite(suite, source) {
  const err = validateSuite(suite);
  if (err) {
    logEntry('err', `Load failed: ${err}`);
    setStatus('idle', `Load failed: ${err}`);
    return false;
  }
  state.steps = suite.steps.map((s, i) => ({
    ...s,
    id: s.id || `step_${Date.now()}_${i + 1}`,
  }));
  state.baseUrl = suite.baseUrl || state.baseUrl;
  state.summary = suite.summary || '';
  if (summaryInput) summaryInput.value = state.summary;
  state.stepCounter = Math.max(state.stepCounter, state.steps.length);
  state.lastReplay = null;
  state.recordingDiagnostics = createEmptyDiagnostics();
  state.recordingDiagnosticKeys = new Set();
  render();
  updateCode();
  persist();
  const label = source ? ` from ${source}` : '';
  logEntry('info', `Loaded ${state.steps.length} step(s)${label}`);
  setStatus('idle', `Loaded ${state.steps.length} step(s)${label}`);
  return true;
}

// Wrap render()/updateCode() so any state mutation also persists.
const _origRender = render;
render = function () {
  _origRender();
  persist();
};

function genStepCode(step, framework) {
  const actualFramework = framework === 'mermaid' ? 'playwright' : framework;
  if (actualFramework === 'playwright') return genPlaywright([step], state.lastReplay?.suiteName || 'recorded flow').split('\n').slice(2, -1).join('\n').trim();
  if (actualFramework === 'cypress') return genCypress([step], state.lastReplay?.suiteName || 'recorded flow').split('\n').slice(2, -2).join('\n').trim();
  if (actualFramework === 'puppeteer') return genPuppeteer([step], state.lastReplay?.suiteName || 'recorded flow').split('\n').slice(4, -1).join('\n').trim();
  return '';
}

function buildCurrentReport() {
  const recordingCounts = diagnosticsCounts(state.recordingDiagnostics);
  if (
    state.steps.length === 0 &&
    !(state.summary && state.summary.trim()) &&
    recordingCounts.total === 0
  ) {
    return null;
  }
  return state.lastReplay
    ? buildBugReport(state.lastReplay, state.steps, {
        summary: state.summary,
        generateStepCode: (step) => genStepCode(step, state.lastReplay.framework),
        recordingDiagnostics: state.recordingDiagnostics,
      })
    : buildBugReport(null, state.steps, {
        summary: state.summary,
        baseUrl: state.baseUrl,
        recordingDiagnostics: state.recordingDiagnostics,
      });
}

function downloadReport(md) {
  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'report.md';
  a.click();
  URL.revokeObjectURL(url);
  logEntry('info', `Exported report.md (${state.lastReplay ? 'with replay' : 'no replay'})`);
}

function openReportPreview() {
  const md = buildCurrentReport();
  if (md == null) {
    alert('Nothing to preview yet. Record some steps or write a summary first.');
    return;
  }
  reportPreview.textContent = md;
  if (reportPreviewMeta) {
    const lines = md.split('\n').length;
    const chars = md.length;
    const mode = state.lastReplay ? 'replay-enriched' : 'recording-only';
    reportPreviewMeta.textContent = `${lines} lines · ${chars} chars · ${mode}`;
  }
  reportModal.hidden = false;
}

function closeReportPreview() {
  if (reportModal) reportModal.hidden = true;
}

if (btnPreviewReport) btnPreviewReport.addEventListener('click', openReportPreview);

if (btnExportReport) {
  btnExportReport.addEventListener('click', () => {
    const md = buildCurrentReport();
    if (md == null) {
      alert('Nothing to export yet. Record some steps or write a summary first.');
      return;
    }
    downloadReport(md);
  });
}

if (btnReportDownload) {
  btnReportDownload.addEventListener('click', () => {
    const md = reportPreview ? reportPreview.textContent : '';
    if (!md) return;
    downloadReport(md);
    closeReportPreview();
  });
}

if (btnReportCopy) {
  btnReportCopy.addEventListener('click', async () => {
    const md = reportPreview ? reportPreview.textContent : '';
    if (!md) return;
    try {
      await navigator.clipboard.writeText(md);
      btnReportCopy.textContent = 'Copied ✓';
      setTimeout(() => { btnReportCopy.textContent = 'Copy'; }, 1500);
    } catch (e) {
      logEntry('err', `Copy failed: ${(e && e.message) || e}`);
    }
  });
}

if (reportModal) {
  reportModal.addEventListener('click', (ev) => {
    if (ev.target instanceof Element && ev.target.hasAttribute('data-close')) {
      closeReportPreview();
    }
  });
}

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && reportModal && !reportModal.hidden) {
    closeReportPreview();
  }
});

if (btnOpenJson && fileInput) {
  btnOpenJson.addEventListener('click', () => {
    if (state.steps.length > 0 || state.summary.trim()) {
      const ok = window.confirm('Loading will replace the current recording. Continue?');
      if (!ok) return;
    }
    fileInput.value = '';
    fileInput.click();
  });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const suite = JSON.parse(text);
      loadSuite(suite, file.name);
    } catch (e) {
      const msg = (e && e.message) || String(e);
      logEntry('err', `Open failed: ${msg}`);
      setStatus('idle', `Open failed: ${msg}`);
    }
  });
}

// ---------- Sessions ----------
const SESSIONS_KEY = 'autoTestRecorder.sessions.v1';
const SETTINGS_KEY = 'autoTestRecorder.settings.v1';

function persistSessions() {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify({
      sessions: state.sessions,
      activeSessionId: state.activeSessionId,
    }));
  } catch (e) {
    console.warn('persistSessions failed:', e && e.message);
  }
}

function rehydrateSessions() {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data && Array.isArray(data.sessions)) {
      state.sessions = data.sessions;
      state.activeSessionId = data.activeSessionId || null;
    }
  } catch (e) {
    console.warn('rehydrateSessions failed:', e && e.message);
  }
}

function persistSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      newReportPerRecording: state.newReportPerRecording,
    }));
  } catch (e) {
    console.warn('persistSettings failed:', e && e.message);
  }
}

function rehydrateSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data && typeof data.newReportPerRecording === 'boolean') {
      state.newReportPerRecording = data.newReportPerRecording;
    }
  } catch (e) {
    console.warn('rehydrateSettings failed:', e && e.message);
  }
}

function defaultSessionName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `Session ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function snapshotState(name) {
  const id = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    name: name || defaultSessionName(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    summary: state.summary,
    steps: JSON.parse(JSON.stringify(state.steps)),
    baseUrl: state.baseUrl,
    recordingDiagnostics: JSON.parse(JSON.stringify(state.recordingDiagnostics)),
    lastReplay: state.lastReplay ? JSON.parse(JSON.stringify(state.lastReplay)) : null,
  };
}

function hasContent() {
  return (
    state.steps.length > 0 ||
    (state.summary && state.summary.trim().length > 0) ||
    diagnosticsCounts(state.recordingDiagnostics).total > 0
  );
}

function saveCurrentAsSession(forceNew) {
  if (!hasContent()) return null;
  if (state.activeSessionId && !forceNew) {
    const idx = state.sessions.findIndex((s) => s.id === state.activeSessionId);
    if (idx >= 0) {
      const updated = snapshotState(state.sessions[idx].name);
      updated.id = state.activeSessionId;
      updated.createdAt = state.sessions[idx].createdAt;
      state.sessions[idx] = updated;
      persistSessions();
      return updated;
    }
  }
  const snapshot = snapshotState();
  state.sessions.unshift(snapshot);
  state.activeSessionId = snapshot.id;
  persistSessions();
  return snapshot;
}

function clearCurrentState() {
  cancelElementComment();
  state.steps = [];
  state.stepCounter = 0;
  state.summary = '';
  state.lastReplay = null;
  state.recordingDiagnostics = createEmptyDiagnostics();
  state.recordingDiagnosticKeys = new Set();
  state.activeSessionId = null;
  if (summaryInput) summaryInput.value = '';
}

function buildSessionReportMd(session) {
  return session.lastReplay
    ? buildBugReport(session.lastReplay, session.steps || [], {
        summary: session.summary || '',
        recordingDiagnostics: session.recordingDiagnostics,
      })
    : buildBugReport(null, session.steps || [], {
        summary: session.summary || '',
        baseUrl: session.baseUrl || '',
        recordingDiagnostics: session.recordingDiagnostics,
      });
}

function loadSessionIntoState(sessionId) {
  const session = state.sessions.find((s) => s.id === sessionId);
  if (!session) return false;
  if (hasContent() && state.activeSessionId !== session.id) {
    const ok = window.confirm('Loading this session will replace your current unsaved work. Continue?');
    if (!ok) return false;
  }
  state.steps = JSON.parse(JSON.stringify(session.steps || []));
  state.summary = session.summary || '';
  state.baseUrl = session.baseUrl || state.baseUrl;
  state.recordingDiagnostics = session.recordingDiagnostics || createEmptyDiagnostics();
  state.recordingDiagnosticKeys = new Set();
  state.lastReplay = session.lastReplay || null;
  state.activeSessionId = session.id;
  state.stepCounter = state.steps.length;
  if (summaryInput) summaryInput.value = state.summary;
  render();
  updateCode();
  renderSessionsList();
  persistSessions();
  logEntry('info', `Loaded session: ${session.name}`);
  setStatus('idle', `Loaded "${session.name}" (${state.steps.length} step(s))`);
  return true;
}

function deleteSessionById(sessionId) {
  const session = state.sessions.find((s) => s.id === sessionId);
  if (!session) return;
  const ok = window.confirm(`Delete "${session.name}"? This cannot be undone.`);
  if (!ok) return;
  state.sessions = state.sessions.filter((s) => s.id !== sessionId);
  if (state.activeSessionId === sessionId) state.activeSessionId = null;
  persistSessions();
  renderSessionsList();
}

function renameSessionById(sessionId) {
  const session = state.sessions.find((s) => s.id === sessionId);
  if (!session) return;
  const next = window.prompt('Rename session', session.name);
  if (next === null) return;
  const trimmed = next.trim();
  if (!trimmed) return;
  session.name = trimmed;
  session.updatedAt = new Date().toISOString();
  persistSessions();
  renderSessionsList();
}

function exportSessionReport(sessionId) {
  const session = state.sessions.find((s) => s.id === sessionId);
  if (!session) return;
  const md = buildSessionReportMd(session);
  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safe = (session.name || 'report').replace(/[^a-zA-Z0-9._-]+/g, '_');
  a.download = `${safe}.md`;
  a.click();
  URL.revokeObjectURL(url);
  logEntry('info', `Exported report for session: ${session.name}`);
}

function previewSessionReport(sessionId) {
  const session = state.sessions.find((s) => s.id === sessionId);
  if (!session || !reportPreview || !reportModal) return;
  const md = buildSessionReportMd(session);
  reportPreview.textContent = md;
  if (reportPreviewMeta) {
    const lines = md.split('\n').length;
    reportPreviewMeta.textContent = `${session.name} · ${lines} lines · ${md.length} chars`;
  }
  reportModal.hidden = false;
}

function exportCombinedReport() {
  if (state.sessions.length === 0) return;
  const lines = [];
  lines.push(`# Combined Bug Report`);
  lines.push('');
  lines.push(`**Sessions**: ${state.sessions.length}`);
  lines.push(`**Generated**: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  state.sessions.forEach((session, i) => {
    lines.push(`<!-- session ${i + 1} of ${state.sessions.length}: ${session.name} -->`);
    lines.push('');
    lines.push(buildSessionReportMd(session));
    lines.push('');
    lines.push('---');
    lines.push('');
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `combined-report.md`;
  a.click();
  URL.revokeObjectURL(url);
  logEntry('info', `Exported combined report (${state.sessions.length} session(s))`);
}

function renderSessionsList() {
  if (!sessionsListEl) return;
  sessionsListEl.innerHTML = '';
  if (state.sessions.length === 0) {
    if (sessionsEmptyEl) sessionsEmptyEl.hidden = false;
    if (btnSessionExportCombined) btnSessionExportCombined.disabled = true;
    return;
  }
  if (sessionsEmptyEl) sessionsEmptyEl.hidden = true;
  if (btnSessionExportCombined) btnSessionExportCombined.disabled = false;
  state.sessions.forEach((session) => {
    const li = document.createElement('li');
    if (session.id === state.activeSessionId) li.classList.add('active-session');

    const top = document.createElement('div');
    top.className = 'session-row-top';
    const name = document.createElement('span');
    name.className = 'session-name';
    name.textContent = session.name;
    top.appendChild(name);
    if (session.id === state.activeSessionId) {
      const tag = document.createElement('span');
      tag.className = 'session-active-tag';
      tag.textContent = 'Active';
      top.appendChild(tag);
    }
    li.appendChild(top);

    const meta = document.createElement('span');
    meta.className = 'session-meta';
    const stepCount = (session.steps || []).length;
    const noteCount = (session.steps || []).filter((s) => s && typeof s.note === 'string' && s.note.trim()).length;
    const issuesCount = diagnosticsCounts(session.recordingDiagnostics).total;
    const when = session.createdAt ? new Date(session.createdAt).toLocaleString() : '';
    meta.textContent = `${stepCount} step(s) · ${noteCount} note(s) · ${issuesCount} captured issue(s) · ${when}`;
    li.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'session-actions';
    const buttons = [
      { label: session.id === state.activeSessionId ? 'Reload' : 'Load', cls: 'btn', fn: () => loadSessionIntoState(session.id) },
      { label: 'Preview', cls: 'btn', fn: () => previewSessionReport(session.id) },
      { label: 'Export .md', cls: 'btn', fn: () => exportSessionReport(session.id) },
      { label: 'Rename', cls: 'btn', fn: () => renameSessionById(session.id) },
      { label: 'Delete', cls: 'btn danger', fn: () => deleteSessionById(session.id) },
    ];
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.className = b.cls;
      btn.type = 'button';
      btn.textContent = b.label;
      btn.onclick = b.fn;
      actions.appendChild(btn);
    }
    li.appendChild(actions);
    sessionsListEl.appendChild(li);
  });
}

function openSessionsModal() {
  if (!sessionsModal) return;
  if (settingNewPerRecording) settingNewPerRecording.checked = !!state.newReportPerRecording;
  renderSessionsList();
  sessionsModal.hidden = false;
}

function closeSessionsModal() {
  if (sessionsModal) sessionsModal.hidden = true;
}

if (btnSessions) btnSessions.addEventListener('click', openSessionsModal);
if (btnSessionNew) btnSessionNew.addEventListener('click', () => {
  if (hasContent()) {
    const ok = window.confirm('Start a new session? Your current unsaved work will be lost (use "Save Current as Session" first to keep it).');
    if (!ok) return;
  }
  clearCurrentState();
  render();
  updateCode();
  renderSessionsList();
  logEntry('info', 'Started a new session');
});
if (btnSessionSaveNow) btnSessionSaveNow.addEventListener('click', () => {
  if (!hasContent()) {
    alert('Nothing to save yet.');
    return;
  }
  const session = saveCurrentAsSession(true);
  if (session) {
    state.activeSessionId = session.id;
    persistSessions();
    renderSessionsList();
    logEntry('info', `Saved as session: ${session.name}`);
  }
});
if (btnSessionExportCombined) btnSessionExportCombined.addEventListener('click', exportCombinedReport);

if (settingNewPerRecording) {
  settingNewPerRecording.addEventListener('change', () => {
    state.newReportPerRecording = !!settingNewPerRecording.checked;
    persistSettings();
  });
}

if (sessionsModal) {
  sessionsModal.addEventListener('click', (ev) => {
    if (ev.target instanceof Element && ev.target.hasAttribute('data-close')) {
      closeSessionsModal();
    }
  });
}

// Esc closes whichever modal is open.
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape') return;
  if (sessionsModal && !sessionsModal.hidden) closeSessionsModal();
});

// ---------- Panel toggle ----------
const PANEL_HIDDEN_KEY = 'autoTestRecorder.panelHidden.v1';
const appRoot = document.getElementById('app');
const btnTogglePanel = document.getElementById('btn-toggle-panel');

function setPanelHidden(hidden) {
  if (!appRoot) return;
  appRoot.classList.toggle('panel-hidden', hidden);
  if (btnTogglePanel) {
    btnTogglePanel.title = hidden ? 'Show left panel' : 'Hide left panel';
    btnTogglePanel.textContent = hidden ? '▶ Show Panel' : '◀ Hide';
  }
  try {
    localStorage.setItem(PANEL_HIDDEN_KEY, hidden ? '1' : '0');
  } catch {}
}

if (btnTogglePanel) {
  btnTogglePanel.addEventListener('click', () => {
    const isHidden = appRoot && appRoot.classList.contains('panel-hidden');
    setPanelHidden(!isHidden);
  });
}

try {
  if (localStorage.getItem(PANEL_HIDDEN_KEY) === '1') setPanelHidden(true);
} catch {}

// ---------- Panel resize ----------
const PANEL_WIDTH_KEY = 'autoTestRecorder.panelWidth.v1';
const PANEL_MIN_WIDTH = 280;
const PANEL_MAX_WIDTH = 900;
const panelResizer = document.getElementById('panel-resizer');

function setPanelWidth(px) {
  const clamped = Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, Math.round(px)));
  if (appRoot) appRoot.style.setProperty('--panel-width', clamped + 'px');
  return clamped;
}

try {
  const saved = parseInt(localStorage.getItem(PANEL_WIDTH_KEY) || '', 10);
  if (Number.isFinite(saved)) setPanelWidth(saved);
} catch {}

if (panelResizer) {
  let dragging = false;
  let startX = 0;
  let startWidth = 0;

  const onMove = (ev) => {
    if (!dragging) return;
    const dx = ev.clientX - startX;
    setPanelWidth(startWidth + dx);
  };

  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    panelResizer.classList.remove('dragging');
    if (appRoot) appRoot.classList.remove('resizing');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    try {
      const cur = getComputedStyle(appRoot).getPropertyValue('--panel-width').trim();
      const px = parseInt(cur, 10);
      if (Number.isFinite(px)) localStorage.setItem(PANEL_WIDTH_KEY, String(px));
    } catch {}
  };

  panelResizer.addEventListener('mousedown', (ev) => {
    ev.preventDefault();
    dragging = true;
    startX = ev.clientX;
    const cur = getComputedStyle(appRoot).getPropertyValue('--panel-width').trim();
    startWidth = parseInt(cur, 10) || 420;
    panelResizer.classList.add('dragging');
    if (appRoot) appRoot.classList.add('resizing');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // Double-click resets to default width.
  panelResizer.addEventListener('dblclick', () => {
    setPanelWidth(420);
    try { localStorage.setItem(PANEL_WIDTH_KEY, '420'); } catch {}
  });
}

// ---------- Initial render ----------
render();
updateCode();
rehydrateSettings();
rehydrateSessions();

// Rehydrate from the last session if the user didn't explicitly clear.
(function rehydrate() {
  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    if (!raw) return;
    const payload = JSON.parse(raw);
    if (!payload || !Array.isArray(payload.steps)) return;
    state.steps = payload.steps;
    if (payload.baseUrl) state.baseUrl = payload.baseUrl;
    if (typeof payload.summary === 'string') {
      state.summary = payload.summary;
      if (summaryInput) summaryInput.value = payload.summary;
    }
    if (Number.isFinite(payload.stepCounter)) state.stepCounter = payload.stepCounter;
    render();
    updateCode();
    if (payload.steps.length > 0 || payload.summary) {
      const when = payload.savedAt ? ` (saved ${payload.savedAt})` : '';
      logEntry('info', `Restored ${state.steps.length} step(s) from last session${when}`);
    }
  } catch (e) {
    console.warn('rehydrate failed:', e && e.message);
  }
})();

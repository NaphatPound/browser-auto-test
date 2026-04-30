'use strict';

// MV3 service worker. Owns recorder state, sessions, and runtime diagnostics.
// Mirrors the Electron app's renderer state so the popup is purely a view.

importScripts('report-utils.js');
const { createEmptyDiagnostics, diagnosticsCounts, buildReport, buildCombinedReport } = self.AutoTestReport;

const STORAGE_KEY = 'autoTestRecorderState';
const SESSIONS_KEY = 'autoTestRecorderSessions';
const SETTINGS_KEY = 'autoTestRecorderSettings';
const MAX_RUNTIME_ISSUES = 100;

let state = {
  recording: false,
  pickingComment: false,
  pickModeTabId: null,
  steps: [],
  baseUrl: null,
  stepCounter: 0,
  recordingTabId: null,
  recordingDiagnostics: createEmptyDiagnostics(),
  recordingDiagnosticKeys: {},
};

let sessions = [];
let activeSessionId = null;
let settings = { newReportPerRecording: true };

function save() {
  return chrome.storage.local.set({ [STORAGE_KEY]: state });
}
function saveSessions() {
  return chrome.storage.local.set({ [SESSIONS_KEY]: { sessions, activeSessionId } });
}
function saveSettings() {
  return chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

async function load() {
  const obj = await chrome.storage.local.get([STORAGE_KEY, SESSIONS_KEY, SETTINGS_KEY]);
  if (obj && obj[STORAGE_KEY]) {
    state = { ...state, ...obj[STORAGE_KEY] };
    if (!state.recordingDiagnostics) state.recordingDiagnostics = createEmptyDiagnostics();
    if (!state.recordingDiagnosticKeys) state.recordingDiagnosticKeys = {};
  }
  if (obj && obj[SESSIONS_KEY]) {
    sessions = Array.isArray(obj[SESSIONS_KEY].sessions) ? obj[SESSIONS_KEY].sessions : [];
    activeSessionId = obj[SESSIONS_KEY].activeSessionId || null;
  }
  if (obj && obj[SETTINGS_KEY]) {
    settings = { ...settings, ...obj[SETTINGS_KEY] };
  }
}

// ---------- Locator ----------
function sameLocator(a, b) {
  return a && b && a.strategy === b.strategy && a.value === b.value;
}

function pickLocator(c) {
  const a = (c && c.attrs) || {};
  if (a['data-testid']) return { strategy: 'testId', value: a['data-testid'] };
  if (a['aria-label']) return { strategy: 'ariaLabel', value: a['aria-label'] };
  if (a.name) return { strategy: 'name', value: a.name };
  if (a.id) return { strategy: 'id', value: a.id };
  if (a.placeholder) return { strategy: 'placeholder', value: a.placeholder };
  if (a.role) return { strategy: 'role', value: a.role };
  if (c && c.text) return { strategy: 'text', value: c.text };
  if (c && c.cssSelector) return { strategy: 'css', value: c.cssSelector };
  return { strategy: 'css', value: (c && c.tag) || '*' };
}

function nextId() {
  state.stepCounter++;
  return `step_${Date.now()}_${state.stepCounter}`;
}

function pushStep(step) {
  if (step.type === 'fill' && step.rawTarget) {
    step.rawTarget = { ...step.rawTarget, text: undefined };
  }

  if (step.type === 'fill' && state.steps.length > 0) {
    let idx = state.steps.length - 1;
    if (state.steps[idx].type === 'wait') idx--;
    const prev = idx >= 0 ? state.steps[idx] : null;
    if (prev && (prev.type === 'click' || prev.type === 'fill') && prev.locator) {
      step.locator = prev.locator;
    }
  }

  if (step.type === 'fill' && state.steps.length > 0) {
    let idx = state.steps.length - 1;
    if (state.steps[idx].type === 'wait') idx--;
    const prev = idx >= 0 ? state.steps[idx] : null;
    if (prev && prev.type === 'fill' && sameLocator(prev.locator, step.locator)) {
      prev.text = step.text;
      save();
      broadcastState();
      return;
    }
  }

  step.id = nextId();
  state.steps.push(step);
  save();
  broadcastState();
}

function broadcastState() {
  chrome.runtime.sendMessage({ type: 'STATE_CHANGED', state: publicState() }).catch(() => {});
}

function publicState() {
  return {
    recording: state.recording,
    pickingComment: state.pickingComment,
    steps: state.steps,
    baseUrl: state.baseUrl,
    recordingTabId: state.recordingTabId,
    recordingDiagnostics: state.recordingDiagnostics,
    sessions,
    activeSessionId,
    settings,
  };
}

async function setContentEnabled(tabId, enabled) {
  try { await chrome.tabs.sendMessage(tabId, { type: 'SET_ENABLED', enabled }); } catch {}
}

async function setContentPickMode(tabId, on) {
  try { await chrome.tabs.sendMessage(tabId, { type: 'SET_PICK_MODE', pickMode: on }); } catch {}
}

// ---------- Recording ----------
function hasContent() {
  return (
    state.steps.length > 0 ||
    diagnosticsCounts(state.recordingDiagnostics).total > 0
  );
}

function snapshotName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `Session ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function snapshot(name) {
  return {
    id: `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: name || snapshotName(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    steps: JSON.parse(JSON.stringify(state.steps)),
    baseUrl: state.baseUrl,
    recordingDiagnostics: JSON.parse(JSON.stringify(state.recordingDiagnostics)),
  };
}

async function archiveCurrentSession(forceNew) {
  if (!hasContent()) return null;
  if (activeSessionId && !forceNew) {
    const idx = sessions.findIndex((s) => s.id === activeSessionId);
    if (idx >= 0) {
      const updated = snapshot(sessions[idx].name);
      updated.id = activeSessionId;
      updated.createdAt = sessions[idx].createdAt;
      sessions[idx] = updated;
      await saveSessions();
      return updated;
    }
  }
  const snap = snapshot();
  sessions.unshift(snap);
  activeSessionId = snap.id;
  await saveSessions();
  return snap;
}

function clearCurrentRecording() {
  state.steps = [];
  state.stepCounter = 0;
  state.baseUrl = null;
  state.recordingDiagnostics = createEmptyDiagnostics();
  state.recordingDiagnosticKeys = {};
  activeSessionId = null;
}

async function startRecording(tab) {
  // Auto-archive previous session when the setting is on.
  if (settings.newReportPerRecording && hasContent()) {
    await archiveCurrentSession(false);
    clearCurrentRecording();
  }
  state.recording = true;
  state.recordingTabId = tab ? tab.id : null;
  state.baseUrl = tab && tab.url ? tab.url : state.baseUrl;
  if (state.recordingTabId != null) await setContentEnabled(state.recordingTabId, true);
  await save();
  await saveSessions();
  broadcastState();
}

async function stopRecording() {
  state.recording = false;
  if (state.recordingTabId != null) await setContentEnabled(state.recordingTabId, false);
  // Auto-save the current recording as a session so it's recoverable.
  if (hasContent()) await archiveCurrentSession(false);
  await save();
  broadcastState();
}

async function clearAll() {
  clearCurrentRecording();
  await save();
  await saveSessions();
  broadcastState();
}

// ---------- Pick mode (Comment Element) ----------
async function startPickMode() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  state.pickingComment = true;
  state.pickModeTabId = tab.id;
  await setContentPickMode(tab.id, true);
  await save();
  broadcastState();
}

async function stopPickMode() {
  if (state.pickModeTabId != null) await setContentPickMode(state.pickModeTabId, false);
  state.pickingComment = false;
  state.pickModeTabId = null;
  await save();
  broadcastState();
}

async function addCommentStep(target, note, pageUrl) {
  const locator = target ? pickLocator(target) : undefined;
  const step = { type: 'comment', locator, note };
  if (pageUrl) step.pageUrl = pageUrl;
  step.id = nextId();
  state.steps.push(step);
  await save();
  broadcastState();
  // Re-arm pick mode if still active (sticky like the Electron app).
  if (state.pickingComment && state.pickModeTabId != null) {
    await setContentPickMode(state.pickModeTabId, true);
  }
}

// ---------- Runtime issues ----------
function diagnosticSignature(kind, issue) {
  return [
    kind,
    issue.stepIndex == null ? '' : issue.stepIndex,
    issue.level || '',
    issue.source || '',
    issue.sourceId || '',
    issue.line || '',
    issue.method || '',
    issue.url || '',
    issue.status || '',
    issue.message || '',
    issue.error || '',
  ].join('|');
}

function recordRuntimeIssue(kind, payload) {
  if (kind !== 'console' && kind !== 'network' && kind !== 'page') return;
  if (!state.recording) return;
  const list = state.recordingDiagnostics[kind];
  if (!Array.isArray(list) || list.length >= MAX_RUNTIME_ISSUES) return;
  const stepIndex = state.steps.length > 0 ? state.steps.length - 1 : null;
  const enriched = { ...payload, stepIndex, capturedAt: new Date().toISOString() };
  const key = diagnosticSignature(kind, enriched);
  if (state.recordingDiagnosticKeys[key]) return;
  state.recordingDiagnosticKeys[key] = true;
  list.push(enriched);
  save();
  broadcastState();
}

// ---------- Export helpers ----------
async function downloadAsFile(content, filename, mime) {
  // Service workers can use chrome.downloads.download with a data: URL since
  // URL.createObjectURL on a Blob isn't available there in MV3.
  const dataUrl = `data:${mime};charset=utf-8;base64,${btoa(unescape(encodeURIComponent(content)))}`;
  try {
    const id = await chrome.downloads.download({ url: dataUrl, filename, saveAs: true });
    return { ok: true, id, filename };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

function buildSuiteJson(name) {
  return JSON.stringify({
    name: name || 'recorded flow',
    baseUrl: state.baseUrl || undefined,
    steps: state.steps,
    createdAt: new Date().toISOString(),
  }, null, 2);
}

async function exportSuite(name) {
  if (state.steps.length === 0) return { ok: false, error: 'No steps recorded' };
  return downloadAsFile(buildSuiteJson(name), `auto-test-suite-${Date.now()}.json`, 'application/json');
}

function buildCurrentReport() {
  if (!hasContent()) return null;
  return buildReport({
    suiteName: 'recorded flow',
    steps: state.steps,
    recordingDiagnostics: state.recordingDiagnostics,
    baseUrl: state.baseUrl,
  });
}

async function exportReportMd() {
  const md = buildCurrentReport();
  if (md == null) return { ok: false, error: 'Nothing to export — record some steps first' };
  return downloadAsFile(md, `report-${Date.now()}.md`, 'text/markdown');
}

function buildSessionReport(sessionId) {
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) return null;
  return buildReport({
    suiteName: session.name,
    steps: session.steps || [],
    recordingDiagnostics: session.recordingDiagnostics,
    baseUrl: session.baseUrl,
  });
}

async function exportSessionReport(sessionId) {
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) return { ok: false, error: 'Session not found' };
  const md = buildSessionReport(sessionId);
  if (!md) return { ok: false, error: 'Failed to build report' };
  const safe = (session.name || 'report').replace(/[^a-zA-Z0-9._-]+/g, '_');
  return downloadAsFile(md, `${safe}.md`, 'text/markdown');
}

async function exportCombined() {
  if (sessions.length === 0) return { ok: false, error: 'No saved sessions' };
  const md = buildCombinedReport(sessions);
  return downloadAsFile(md, `combined-report-${Date.now()}.md`, 'text/markdown');
}

// ---------- Session management ----------
async function loadSessionIntoState(sessionId) {
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) return false;
  state.steps = JSON.parse(JSON.stringify(session.steps || []));
  state.baseUrl = session.baseUrl || null;
  state.recordingDiagnostics = session.recordingDiagnostics || createEmptyDiagnostics();
  state.recordingDiagnosticKeys = {};
  state.stepCounter = state.steps.length;
  activeSessionId = session.id;
  await save();
  await saveSessions();
  broadcastState();
  return true;
}

async function deleteSessionById(sessionId) {
  sessions = sessions.filter((s) => s.id !== sessionId);
  if (activeSessionId === sessionId) activeSessionId = null;
  await saveSessions();
  broadcastState();
}

async function renameSessionById(sessionId, name) {
  const s = sessions.find((x) => x.id === sessionId);
  if (!s) return;
  s.name = name;
  s.updatedAt = new Date().toISOString();
  await saveSessions();
  broadcastState();
}

async function saveCurrentManually() {
  const snap = await archiveCurrentSession(true);
  return snap;
}

// ---------- Message router ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (!msg || !msg.type) return;

    // Content-script-originated traffic
    if (msg.type === 'RECORDER_PING') {
      const enabled = state.recording && sender.tab && sender.tab.id === state.recordingTabId;
      const pickMode = state.pickingComment && sender.tab && sender.tab.id === state.pickModeTabId;
      sendResponse({ enabled, pickMode });
      return;
    }
    if (msg.type === 'RECORDER_STEP') {
      if (!state.recording) return;
      if (sender.tab && sender.tab.id !== state.recordingTabId) return;
      const raw = msg.step;
      if (!raw) return;
      const locator = pickLocator(raw.target || { attrs: {} });
      const step = { type: raw.type, locator };
      if (raw.text !== undefined) step.text = raw.text;
      if (raw.selectValue !== undefined) step.selectValue = raw.selectValue;
      if (raw.key !== undefined) step.key = raw.key;
      pushStep(step);
      return;
    }
    if (msg.type === 'RECORDER_PICK_ELEMENT') {
      // Comment overlay was completed in-page; save the comment step.
      const target = msg.target;
      const note = msg.note || '';
      const pageUrl = msg.pageUrl || '';
      if (!note.trim()) return;
      await addCommentStep(target, note.trim(), pageUrl);
      return;
    }
    if (msg.type === 'RECORDER_PICK_CANCELLED') {
      await stopPickMode();
      return;
    }
    if (msg.type === 'RUNTIME_ISSUE') {
      recordRuntimeIssue(msg.kind, msg.payload || {});
      return;
    }

    // Popup-originated commands
    if (msg.type === 'GET_STATE') { sendResponse({ state: publicState() }); return; }
    if (msg.type === 'START_RECORDING') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await startRecording(tab);
      sendResponse({ ok: true, state: publicState() });
      return;
    }
    if (msg.type === 'STOP_RECORDING') { await stopRecording(); sendResponse({ ok: true, state: publicState() }); return; }
    if (msg.type === 'CLEAR_STEPS') { await clearAll(); sendResponse({ ok: true, state: publicState() }); return; }

    if (msg.type === 'START_PICK_MODE') { await startPickMode(); sendResponse({ ok: true, state: publicState() }); return; }
    if (msg.type === 'STOP_PICK_MODE') { await stopPickMode(); sendResponse({ ok: true, state: publicState() }); return; }

    if (msg.type === 'EXPORT_SUITE') { sendResponse(await exportSuite(msg.name)); return; }
    if (msg.type === 'EXPORT_REPORT') { sendResponse(await exportReportMd()); return; }
    if (msg.type === 'PREVIEW_REPORT') { sendResponse({ ok: true, md: buildCurrentReport() }); return; }

    if (msg.type === 'LIST_SESSIONS') { sendResponse({ sessions, activeSessionId }); return; }
    if (msg.type === 'LOAD_SESSION') { sendResponse({ ok: await loadSessionIntoState(msg.id) }); return; }
    if (msg.type === 'DELETE_SESSION') { await deleteSessionById(msg.id); sendResponse({ ok: true }); return; }
    if (msg.type === 'RENAME_SESSION') { await renameSessionById(msg.id, msg.name); sendResponse({ ok: true }); return; }
    if (msg.type === 'SAVE_CURRENT_AS_SESSION') { const s = await saveCurrentManually(); sendResponse({ ok: !!s, session: s }); return; }
    if (msg.type === 'EXPORT_SESSION_REPORT') { sendResponse(await exportSessionReport(msg.id)); return; }
    if (msg.type === 'PREVIEW_SESSION_REPORT') { sendResponse({ ok: true, md: buildSessionReport(msg.id) }); return; }
    if (msg.type === 'EXPORT_COMBINED_REPORT') { sendResponse(await exportCombined()); return; }

    if (msg.type === 'UPDATE_SETTINGS') {
      settings = { ...settings, ...(msg.settings || {}) };
      await saveSettings();
      broadcastState();
      sendResponse({ ok: true, settings });
      return;
    }
  })();
  return true;
});

// ---------- Navigation tracking ----------
function trackNavigation(details) {
  if (!state.recording || details.frameId !== 0) return;
  if (details.tabId !== state.recordingTabId) return;
  if (!details.url || details.url.startsWith('chrome://')) return;
  state.steps.push({ id: nextId(), type: 'navigate', url: details.url });
  if (!state.baseUrl) state.baseUrl = details.url;
  save();
  broadcastState();
}

chrome.webNavigation.onCommitted.addListener(trackNavigation);
chrome.webNavigation.onHistoryStateUpdated.addListener(trackNavigation);

chrome.webNavigation.onCompleted.addListener(async (details) => {
  if (details.frameId !== 0) return;
  if (state.recording && details.tabId === state.recordingTabId) {
    await setContentEnabled(details.tabId, true);
  }
  if (state.pickingComment && details.tabId === state.pickModeTabId) {
    await setContentPickMode(details.tabId, true);
  }
});

load();

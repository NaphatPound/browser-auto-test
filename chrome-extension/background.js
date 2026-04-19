'use strict';

// MV3 service worker. Owns recorder state (recording flag + steps array),
// mirrors it to chrome.storage.local for persistence across restarts,
// broadcasts SET_ENABLED to content scripts, and exposes EXPORT_SUITE for
// the popup.

const STORAGE_KEY = 'autoTestRecorderState';

let state = {
  recording: false,
  steps: [],
  baseUrl: null,
  stepCounter: 0,
  recordingTabId: null,
};

function save() {
  return chrome.storage.local.set({ [STORAGE_KEY]: state });
}

async function load() {
  const obj = await chrome.storage.local.get(STORAGE_KEY);
  if (obj && obj[STORAGE_KEY]) state = { ...state, ...obj[STORAGE_KEY] };
}

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
  // Pipeline guard (bug06): fill steps must never use `text` as the locator —
  // replay would search for post-fill content in the pre-fill DOM.
  if (step.type === 'fill' && step.rawTarget) {
    step.rawTarget = { ...step.rawTarget, text: undefined };
  }

  // Carry-forward: a fill right after a click or fill should reuse the
  // previous non-wait locator — same target in the "click to focus, type" flow.
  if (step.type === 'fill' && state.steps.length > 0) {
    let idx = state.steps.length - 1;
    if (state.steps[idx].type === 'wait') idx--;
    const prev = idx >= 0 ? state.steps[idx] : null;
    if (prev && (prev.type === 'click' || prev.type === 'fill') && prev.locator) {
      step.locator = prev.locator;
    }
  }

  // Collapse adjacent fills on the same locator — keystrokes become one step
  // with the final text.
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
  // Push to any open popup so its UI stays in sync.
  chrome.runtime.sendMessage({ type: 'STATE_CHANGED', state: publicState() }).catch(() => {});
}

function publicState() {
  return {
    recording: state.recording,
    steps: state.steps,
    baseUrl: state.baseUrl,
    recordingTabId: state.recordingTabId,
  };
}

async function setContentEnabled(tabId, enabled) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'SET_ENABLED', enabled });
  } catch (e) {
    // Content script may not be injected yet on this tab.
  }
}

async function startRecording(tab) {
  state.recording = true;
  state.recordingTabId = tab ? tab.id : null;
  state.baseUrl = tab && tab.url ? tab.url : state.baseUrl;
  if (state.recordingTabId != null) await setContentEnabled(state.recordingTabId, true);
  await save();
  broadcastState();
}

async function stopRecording() {
  state.recording = false;
  if (state.recordingTabId != null) await setContentEnabled(state.recordingTabId, false);
  await save();
  broadcastState();
}

async function clearSteps() {
  state.steps = [];
  state.stepCounter = 0;
  state.baseUrl = null;
  await save();
  broadcastState();
}

function buildSuite(name) {
  return {
    name: name || 'recorded flow',
    baseUrl: state.baseUrl || undefined,
    steps: state.steps,
    createdAt: new Date().toISOString(),
  };
}

async function exportSuite(name) {
  if (state.steps.length === 0) return { ok: false, error: 'No steps recorded' };
  const suite = buildSuite(name);
  const blob = new Blob([JSON.stringify(suite, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const filename = `auto-test-suite-${Date.now()}.json`;
  try {
    const id = await chrome.downloads.download({ url, filename, saveAs: true });
    return { ok: true, id, filename };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (!msg || !msg.type) return;

    if (msg.type === 'RECORDER_PING') {
      const enabled =
        state.recording && sender.tab && sender.tab.id === state.recordingTabId;
      sendResponse({ enabled });
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

    if (msg.type === 'START_RECORDING') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await startRecording(tab);
      sendResponse({ ok: true, state: publicState() });
      return;
    }

    if (msg.type === 'STOP_RECORDING') {
      await stopRecording();
      sendResponse({ ok: true, state: publicState() });
      return;
    }

    if (msg.type === 'CLEAR_STEPS') {
      await clearSteps();
      sendResponse({ ok: true, state: publicState() });
      return;
    }

    if (msg.type === 'GET_STATE') {
      sendResponse({ state: publicState() });
      return;
    }

    if (msg.type === 'EXPORT_SUITE') {
      const result = await exportSuite(msg.name);
      sendResponse(result);
      return;
    }
  })();
  return true; // keep sendResponse channel open for async
});

// Navigation tracking — emit `navigate` steps when the recorded tab commits
// a top-level navigation. Includes SPA history changes.
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

// Re-inject SET_ENABLED whenever a tab finishes loading while we're recording,
// so the content script on the new page knows to capture.
chrome.webNavigation.onCompleted.addListener(async (details) => {
  if (details.frameId !== 0) return;
  if (!state.recording || details.tabId !== state.recordingTabId) return;
  await setContentEnabled(details.tabId, true);
});

load();

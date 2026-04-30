'use strict';

// Popup is purely a view: it queries the background service worker for
// state, dispatches commands, and listens for STATE_CHANGED broadcasts.

const $ = (id) => document.getElementById(id);
const btnStart = $('btn-start');
const btnStop = $('btn-stop');
const btnClear = $('btn-clear');
const btnComment = $('btn-comment');
const btnExportJson = $('btn-export-json');
const btnPreviewReport = $('btn-preview-report');
const btnExportReport = $('btn-export-report');
const btnSessions = $('btn-sessions');
const statusEl = $('status');
const stepList = $('step-list');
const stepCountEl = $('step-count');
const bugCountEl = $('bug-count');
const issueCountEl = $('issue-count');
const emptyHintEl = $('empty-hint');
const reportModal = $('report-modal');
const reportPreview = $('report-preview');
const reportMeta = $('report-meta');
const btnReportCopy = $('btn-report-copy');
const btnReportDownload = $('btn-report-download');
const sessionsModal = $('sessions-modal');
const sessionsListEl = $('sessions-list');
const sessionsEmpty = $('sessions-empty');
const settingNewPerRecording = $('setting-new-per-recording');
const btnSessionSaveNow = $('btn-session-save-now');
const btnSessionExportCombined = $('btn-session-export-combined');

const Report = self.AutoTestReport;

let lastState = null;

function send(msg) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (resp) => resolve(resp));
    } catch {
      resolve(null);
    }
  });
}

function describeStep(s) { return Report.describeStep(s, { includeNote: true }); }
function diagnosticsCounts(d) { return Report.diagnosticsCounts(d); }

function render(state) {
  if (!state) return;
  lastState = state;
  const recording = !!state.recording;
  const picking = !!state.pickingComment;
  btnStart.disabled = recording;
  btnStop.disabled = !recording;
  btnComment.classList.toggle('active', picking);
  btnComment.textContent = picking ? '■ Stop Commenting' : 'Comment Element';

  if (picking) {
    statusEl.className = 'status picking';
    statusEl.textContent = 'Picking…';
  } else if (recording) {
    statusEl.className = 'status recording';
    statusEl.textContent = 'Recording…';
  } else {
    statusEl.className = 'status idle';
    statusEl.textContent = 'Idle';
  }

  const steps = state.steps || [];
  const notes = steps.filter((s) => s && typeof s.note === 'string' && s.note.trim()).length;
  const issues = diagnosticsCounts(state.recordingDiagnostics).total;

  stepCountEl.textContent = String(steps.length);
  bugCountEl.textContent = String(notes);
  issueCountEl.textContent = String(issues);

  stepList.innerHTML = '';
  if (steps.length === 0) {
    if (emptyHintEl) emptyHintEl.hidden = false;
  } else {
    if (emptyHintEl) emptyHintEl.hidden = true;
    steps.forEach((s, i) => {
      const li = document.createElement('li');
      if (s.type === 'comment') li.classList.add('is-comment');
      const idx = document.createElement('span');
      idx.className = 'idx';
      idx.textContent = String(i + 1);
      const type = document.createElement('span');
      type.className = 'type';
      type.textContent = s.type;
      const desc = document.createElement('span');
      desc.className = 'desc';
      desc.textContent = describeStep(s);
      li.appendChild(idx);
      li.appendChild(type);
      li.appendChild(desc);
      stepList.appendChild(li);
    });
  }

  const hasContent = steps.length > 0 || issues > 0;
  btnPreviewReport.disabled = !hasContent;
  btnExportReport.disabled = !hasContent;

  if (settingNewPerRecording && state.settings) {
    settingNewPerRecording.checked = !!state.settings.newReportPerRecording;
  }
}

async function refresh() {
  const resp = await send({ type: 'GET_STATE' });
  if (resp && resp.state) render(resp.state);
}

// ---------- Wire main controls ----------
btnStart.addEventListener('click', async () => {
  const resp = await send({ type: 'START_RECORDING' });
  if (resp && resp.state) render(resp.state);
});

btnStop.addEventListener('click', async () => {
  const resp = await send({ type: 'STOP_RECORDING' });
  if (resp && resp.state) render(resp.state);
});

btnClear.addEventListener('click', async () => {
  if (!confirm('Clear all current steps and captured issues?')) return;
  const resp = await send({ type: 'CLEAR_STEPS' });
  if (resp && resp.state) render(resp.state);
});

btnComment.addEventListener('click', async () => {
  if (lastState && lastState.pickingComment) {
    await send({ type: 'STOP_PICK_MODE' });
  } else {
    await send({ type: 'START_PICK_MODE' });
    // Close the popup so the cursor lands on the page — Chrome popups grab focus.
    window.close();
    return;
  }
  refresh();
});

btnExportJson.addEventListener('click', async () => {
  const resp = await send({ type: 'EXPORT_SUITE' });
  if (resp && !resp.ok) alert(resp.error || 'Export failed');
});

// ---------- Report preview / export ----------
function showReport(md, metaText) {
  if (!reportModal || !reportPreview) return;
  reportPreview.textContent = md;
  if (reportMeta) reportMeta.textContent = metaText || `${md.split('\n').length} lines · ${md.length} chars`;
  reportModal.hidden = false;
  reportPreview._currentMd = md;
}

btnPreviewReport.addEventListener('click', async () => {
  const resp = await send({ type: 'PREVIEW_REPORT' });
  if (!resp || !resp.ok || !resp.md) {
    alert('Nothing to preview yet.');
    return;
  }
  showReport(resp.md);
});

btnExportReport.addEventListener('click', async () => {
  const resp = await send({ type: 'EXPORT_REPORT' });
  if (resp && !resp.ok) alert(resp.error || 'Export failed');
});

if (btnReportCopy) {
  btnReportCopy.addEventListener('click', async () => {
    const md = reportPreview._currentMd || '';
    if (!md) return;
    try {
      await navigator.clipboard.writeText(md);
      btnReportCopy.textContent = 'Copied ✓';
      setTimeout(() => { btnReportCopy.textContent = 'Copy'; }, 1500);
    } catch {}
  });
}

if (btnReportDownload) {
  btnReportDownload.addEventListener('click', async () => {
    const md = reportPreview._currentMd || '';
    if (!md) return;
    // Use the same export path so the file lands wherever Chrome downloads go.
    const resp = await send({ type: 'EXPORT_REPORT' });
    if (resp && !resp.ok) alert(resp.error || 'Export failed');
    reportModal.hidden = true;
  });
}

if (reportModal) {
  reportModal.addEventListener('click', (ev) => {
    if (ev.target instanceof Element && ev.target.hasAttribute('data-close')) {
      reportModal.hidden = true;
    }
  });
}

// ---------- Sessions ----------
async function openSessionsModal() {
  await refresh();
  renderSessionsList(lastState && lastState.sessions, lastState && lastState.activeSessionId);
  sessionsModal.hidden = false;
}

btnSessions.addEventListener('click', openSessionsModal);

if (sessionsModal) {
  sessionsModal.addEventListener('click', (ev) => {
    if (ev.target instanceof Element && ev.target.hasAttribute('data-close')) {
      sessionsModal.hidden = true;
    }
  });
}

if (settingNewPerRecording) {
  settingNewPerRecording.addEventListener('change', async () => {
    await send({ type: 'UPDATE_SETTINGS', settings: { newReportPerRecording: !!settingNewPerRecording.checked } });
  });
}

if (btnSessionSaveNow) {
  btnSessionSaveNow.addEventListener('click', async () => {
    const resp = await send({ type: 'SAVE_CURRENT_AS_SESSION' });
    if (!resp || !resp.ok) {
      alert('Nothing to save yet.');
      return;
    }
    refresh().then(() => renderSessionsList(lastState.sessions, lastState.activeSessionId));
  });
}

if (btnSessionExportCombined) {
  btnSessionExportCombined.addEventListener('click', async () => {
    const resp = await send({ type: 'EXPORT_COMBINED_REPORT' });
    if (resp && !resp.ok) alert(resp.error || 'Export failed');
  });
}

function renderSessionsList(list, activeId) {
  if (!sessionsListEl) return;
  sessionsListEl.innerHTML = '';
  list = list || [];
  if (sessionsEmpty) sessionsEmpty.hidden = list.length > 0;
  if (btnSessionExportCombined) btnSessionExportCombined.disabled = list.length === 0;
  list.forEach((session) => {
    const li = document.createElement('li');
    if (session.id === activeId) li.classList.add('active-session');
    const head = document.createElement('div');
    const name = document.createElement('span');
    name.className = 'session-name';
    name.textContent = session.name;
    head.appendChild(name);
    if (session.id === activeId) {
      const tag = document.createElement('span');
      tag.className = 'session-active-tag';
      tag.textContent = 'Active';
      head.appendChild(tag);
    }
    li.appendChild(head);
    const meta = document.createElement('span');
    meta.className = 'session-meta';
    const stepCount = (session.steps || []).length;
    const noteCount = (session.steps || []).filter((s) => s && typeof s.note === 'string' && s.note.trim()).length;
    const issuesCount = diagnosticsCounts(session.recordingDiagnostics).total;
    const when = session.createdAt ? new Date(session.createdAt).toLocaleString() : '';
    meta.textContent = `${stepCount} step(s) · ${noteCount} note(s) · ${issuesCount} issue(s) · ${when}`;
    li.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'session-actions';
    const make = (label, cls, fn) => {
      const b = document.createElement('button');
      b.className = `btn ${cls || ''}`.trim();
      b.type = 'button';
      b.textContent = label;
      b.onclick = fn;
      return b;
    };
    actions.appendChild(make('Load', '', async () => {
      await send({ type: 'LOAD_SESSION', id: session.id });
      sessionsModal.hidden = true;
      refresh();
    }));
    actions.appendChild(make('Preview', '', async () => {
      const resp = await send({ type: 'PREVIEW_SESSION_REPORT', id: session.id });
      if (resp && resp.ok && resp.md) showReport(resp.md, `${session.name} · ${resp.md.length} chars`);
    }));
    actions.appendChild(make('Export .md', '', async () => {
      const resp = await send({ type: 'EXPORT_SESSION_REPORT', id: session.id });
      if (resp && !resp.ok) alert(resp.error || 'Export failed');
    }));
    actions.appendChild(make('Rename', '', async () => {
      const next = prompt('Rename session', session.name);
      if (next === null) return;
      const trimmed = next.trim();
      if (!trimmed) return;
      await send({ type: 'RENAME_SESSION', id: session.id, name: trimmed });
      refresh().then(() => renderSessionsList(lastState.sessions, lastState.activeSessionId));
    }));
    actions.appendChild(make('Delete', 'danger', async () => {
      if (!confirm(`Delete "${session.name}"?`)) return;
      await send({ type: 'DELETE_SESSION', id: session.id });
      refresh().then(() => renderSessionsList(lastState.sessions, lastState.activeSessionId));
    }));
    li.appendChild(actions);
    sessionsListEl.appendChild(li);
  });
}

// ---------- Live updates ----------
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'STATE_CHANGED' && msg.state) render(msg.state);
});

refresh();

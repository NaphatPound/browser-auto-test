'use strict';

const btnStart = document.getElementById('btn-start');
const btnStop = document.getElementById('btn-stop');
const btnClear = document.getElementById('btn-clear');
const btnDownload = document.getElementById('btn-download');
const statusEl = document.getElementById('status');
const stepList = document.getElementById('step-list');
const stepCount = document.getElementById('step-count');

function describeStep(s) {
  if (s.type === 'navigate') return s.url || '';
  if (s.type === 'wait') return `${(s.timeoutMs || 0) / 1000}s`;
  const loc = s.locator ? `${s.locator.strategy}=${s.locator.value}` : '';
  const extra = s.text ? ` "${s.text}"` : s.selectValue ? ` = ${s.selectValue}` : s.key ? ` [${s.key}]` : '';
  return `${loc}${extra}`;
}

function render(state) {
  const recording = !!state.recording;
  btnStart.disabled = recording;
  btnStop.disabled = !recording;
  statusEl.className = recording ? 'status recording' : 'status idle';
  statusEl.textContent = recording ? 'Recording…' : 'Idle';

  const steps = state.steps || [];
  stepCount.textContent = `(${steps.length})`;
  stepList.innerHTML = '';
  steps.forEach((s, i) => {
    const li = document.createElement('li');
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

function refresh() {
  chrome.runtime.sendMessage({ type: 'GET_STATE' }, (resp) => {
    if (resp && resp.state) render(resp.state);
  });
}

btnStart.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'START_RECORDING' }, (resp) => {
    if (resp && resp.state) render(resp.state);
  });
});

btnStop.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }, (resp) => {
    if (resp && resp.state) render(resp.state);
  });
});

btnClear.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'CLEAR_STEPS' }, (resp) => {
    if (resp && resp.state) render(resp.state);
  });
});

btnDownload.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'EXPORT_SUITE' }, (resp) => {
    if (!resp) return;
    if (!resp.ok) {
      statusEl.textContent = resp.error || 'Export failed';
      statusEl.className = 'status error';
    }
  });
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'STATE_CHANGED' && msg.state) render(msg.state);
});

refresh();

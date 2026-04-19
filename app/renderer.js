'use strict';

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
const btnClear = document.getElementById('btn-clear');
const btnExportJson = document.getElementById('btn-export-json');
const btnOpenJson = document.getElementById('btn-open-json');
const fileInput = document.getElementById('file-input');
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

if (window.mermaid) {
  window.mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose' });
}

const state = {
  recording: false,
  replaying: false,
  steps: [],
  framework: 'playwright',
  baseUrl: 'https://example.com',
  stepCounter: 0,
};

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
  let value = '';
  if (step.text) value = ` '${step.text}'`;
  else if (step.selectValue) value = ` '${step.selectValue}'`;
  else if (step.key) value = ` [${step.key}]`;
  return sanitizeMermaidLabel(`${type}${detail}${value}`);
}

function stepShape(step) {
  switch (step.type) {
    case 'navigate': return ['[[', ']]'];
    case 'wait': return ['((', '))'];
    case 'assertText':
    case 'assertVisible': return ['{', '}'];
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
      target.textContent = describeStep(s);
    }
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

function describeStep(s) {
  if (s.type === 'navigate') return s.url || '';
  if (s.type === 'wait') return `${(s.timeoutMs || 0) / 1000}s (${s.timeoutMs || 0}ms)`;
  const loc = s.locator ? `${s.locator.strategy}=${s.locator.value}` : '';
  const extra = s.text ? ` "${s.text}"` : s.selectValue ? ` = ${s.selectValue}` : s.key ? ` [${s.key}]` : '';
  return `${loc}${extra}`;
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
  setStatus(on ? 'recording' : 'idle', on ? 'Recording…' : 'Idle');
}

// ---------- Event wiring ----------
btnRecord.addEventListener('click', () => {
  setRecording(true);
  // Return keyboard focus to the webview so the next keystroke lands in the
  // page and is captured by the preload — otherwise typing hits the Electron
  // chrome and the text appears to float "over the website."
  if (wv && wv.focus) wv.focus();
});
btnStop.addEventListener('click', () => setRecording(false));

btnClear.addEventListener('click', () => {
  state.steps = [];
  state.stepCounter = 0;
  render();
  updateCode();
});

if (btnExportJson) {
  btnExportJson.addEventListener('click', () => {
    if (state.steps.length === 0) {
      alert('No steps to export.');
      return;
    }
    const suite = {
      name: 'recorded flow',
      baseUrl: state.baseUrl,
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

btnReplay.addEventListener('click', () => replay());

urlForm.addEventListener('submit', (e) => {
  e.preventDefault();
  navigateTo(urlInput.value.trim());
});
btnGo.addEventListener('click', () => navigateTo(urlInput.value.trim()));
btnBack.addEventListener('click', () => wv.canGoBack() && wv.goBack());
btnForward.addEventListener('click', () => wv.canGoForward() && wv.goForward());
btnReload.addEventListener('click', () => wv.reload());

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
  state.baseUrl = state.baseUrl || url;
  wv.loadURL(url);
  if (state.recording) {
    pushStep({ type: 'navigate', url });
  }
}

function sameLocator(a, b) {
  return a && b && a.strategy === b.strategy && a.value === b.value;
}

function pushStep(step) {
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
  if (autoWaitToggle && autoWaitToggle.checked && step.type !== 'wait') {
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
});

wv.addEventListener('did-navigate', (e) => {
  urlInput.value = e.url;
});
wv.addEventListener('did-navigate-in-page', (e) => {
  urlInput.value = e.url;
});

wv.addEventListener('ipc-message', (ev) => {
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
  btnReplay.disabled = true;
  btnRecord.disabled = true;
  setStatus('replaying', 'Replaying…');

  const delay = parseInt(speedSel.value, 10);
  const lis = stepList.querySelectorAll('li:not(.insert-slot)');

  clearLog();
  logEntry('info', `— Replay started · ${state.steps.length} step(s) · speed=${delay}ms —`);
  const startedAt = performance.now();
  let failures = 0;

  for (let i = 0; i < state.steps.length; i++) {
    lis.forEach((el) => el.classList.remove('active'));
    if (lis[i]) {
      lis[i].classList.remove('failed');
      lis[i].classList.add('active');
    }
    const desc = describeStep(state.steps[i]);
    logEntry('run', `Step ${i + 1}/${state.steps.length}: ${state.steps[i].type} — ${desc}`);
    const stepStart = performance.now();
    try {
      await runStep(state.steps[i]);
      const ms = Math.round(performance.now() - stepStart);
      logEntry('ok', `Step ${i + 1} ok (${ms}ms)`);
    } catch (err) {
      failures++;
      if (lis[i]) lis[i].classList.add('failed');
      const ms = Math.round(performance.now() - stepStart);
      const message = (err && err.message) || String(err);
      logEntry('err', `Step ${i + 1} FAILED (${ms}ms): ${message}`);
      console.warn('Replay step failed:', desc, message);
    }
    await sleep(delay);
  }

  lis.forEach((el) => el.classList.remove('active'));
  const total = Math.round(performance.now() - startedAt);
  const summary = failures === 0
    ? `— Replay done · all ${state.steps.length} passed · ${total}ms —`
    : `— Replay done · ${state.steps.length - failures} passed · ${failures} FAILED · ${total}ms —`;
  logEntry(failures === 0 ? 'info' : 'err', summary);
  setStatus('idle', failures === 0 ? 'Replay done' : `Replay done (${failures} failed)`);
  state.replaying = false;
  btnReplay.disabled = false;
  btnRecord.disabled = false;
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
  state.stepCounter = Math.max(state.stepCounter, state.steps.length);
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

if (btnOpenJson && fileInput) {
  btnOpenJson.addEventListener('click', () => {
    if (state.steps.length > 0) {
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

// ---------- Initial render ----------
render();
updateCode();

// Rehydrate from the last session if the user didn't explicitly clear.
(function rehydrate() {
  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    if (!raw) return;
    const payload = JSON.parse(raw);
    if (!payload || !Array.isArray(payload.steps) || payload.steps.length === 0) return;
    state.steps = payload.steps;
    if (payload.baseUrl) state.baseUrl = payload.baseUrl;
    if (Number.isFinite(payload.stepCounter)) state.stepCounter = payload.stepCounter;
    render();
    updateCode();
    const when = payload.savedAt ? ` (saved ${payload.savedAt})` : '';
    logEntry('info', `Restored ${state.steps.length} step(s) from last session${when}`);
  } catch (e) {
    console.warn('rehydrate failed:', e && e.message);
  }
})();

'use strict';

// Page-level recorder + comment-element pick mode + runtime issue probe.
// Sends every captured step / picked element / runtime issue to the
// background service worker, which owns the canonical state.

const DEFAULT_ATTRS = ['data-testid', 'id', 'name', 'aria-label', 'role', 'type', 'placeholder'];
const RUNTIME_EVENT = '__auto_test_runtime_issue__';

let enabled = false;
let pickMode = false;
let pickHover = null;

// ---------- Locator extraction ----------
function cssPath(el) {
  const parts = [];
  let cur = el;
  while (cur && cur.nodeType === 1) {
    let seg = cur.tagName.toLowerCase();
    if (cur.id) {
      parts.unshift(seg + '#' + CSS.escape(cur.id));
      return parts.join(' > ');
    }
    const parent = cur.parentElement;
    if (parent) {
      const sameTag = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
      if (sameTag.length > 1) seg += ':nth-of-type(' + (sameTag.indexOf(cur) + 1) + ')';
    }
    parts.unshift(seg);
    cur = parent;
  }
  return parts.join(' > ');
}

function isEditable(el) {
  if (el.tagName === 'INPUT') {
    const t = el.type;
    return t !== 'checkbox' && t !== 'radio' && t !== 'submit' && t !== 'button';
  }
  if (el.tagName === 'TEXTAREA') return true;
  if (el.isContentEditable === true) return true;
  const ce = el.getAttribute && el.getAttribute('contenteditable');
  return ce === '' || ce === 'true' || ce === 'plaintext-only';
}

function readEditableValue(el) {
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return el.value || '';
  return el.textContent || '';
}

function extractCandidate(el) {
  const attrs = {};
  for (const n of DEFAULT_ATTRS) {
    const v = el.getAttribute(n);
    if (v != null) attrs[n] = v;
  }
  const rawText = isEditable(el) ? '' : (el.textContent || '').trim();
  return {
    attrs,
    tag: el.tagName.toLowerCase(),
    text: rawText.length > 0 && rawText.length < 80 ? rawText : undefined,
    cssSelector: cssPath(el),
  };
}

function locatorLabel(c) {
  const a = (c && c.attrs) || {};
  if (a['data-testid']) return `testId=${a['data-testid']}`;
  if (a['aria-label']) return `aria=${a['aria-label']}`;
  if (a.name) return `name=${a.name}`;
  if (a.id) return `id=${a.id}`;
  if (c.text) return `text=${c.text.slice(0, 40)}`;
  return `css=${c.cssSelector || c.tag || '*'}`;
}

function resolveTarget(ev) {
  const path = typeof ev.composedPath === 'function' ? ev.composedPath() : [];
  for (const n of path) {
    if (n && n.nodeType === 1) return n;
  }
  const t = ev.target;
  return t && t.nodeType === 1 ? t : null;
}

const INTERACTIVE_TAGS = new Set(['BUTTON', 'A', 'INPUT', 'TEXTAREA', 'SELECT', 'LABEL', 'SUMMARY']);
const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'checkbox', 'radio', 'menuitem', 'tab', 'option',
  'switch', 'textbox', 'combobox', 'searchbox',
]);

function isInteractive(el) {
  if (!el || !el.tagName) return false;
  if (INTERACTIVE_TAGS.has(el.tagName)) return true;
  const role = el.getAttribute && el.getAttribute('role');
  if (role && INTERACTIVE_ROLES.has(role)) return true;
  if (el.hasAttribute && el.hasAttribute('onclick')) return true;
  return false;
}

function resolveInteractive(ev) {
  const t = resolveTarget(ev);
  if (!t) return null;
  if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return t;

  let outermost = null;
  let cur = t;
  while (cur) {
    const ce = cur.getAttribute ? cur.getAttribute('contenteditable') : null;
    if (ce === '' || ce === 'true' || ce === 'plaintext-only') outermost = cur;
    cur = cur.parentElement;
  }
  if (outermost) return outermost;

  if (ev.type === 'click' || ev.type === 'keydown') {
    let anc = t;
    while (anc && anc !== document.body && anc !== document.documentElement) {
      if (isInteractive(anc)) return anc;
      anc = anc.parentElement;
    }
  }
  return t;
}

// ---------- Background bridge ----------
function sendBg(payload) {
  try { chrome.runtime.sendMessage(payload).catch(() => {}); } catch {}
}

function sendStep(step) {
  if (!enabled) return;
  sendBg({ type: 'RECORDER_STEP', step });
}

// ---------- Pick mode ----------
function clearPickHover() {
  if (!pickHover) return;
  try {
    pickHover.style.outline = pickHover.__autoTestPrevOutline || '';
    pickHover.style.outlineOffset = pickHover.__autoTestPrevOutlineOffset || '';
  } catch {}
  pickHover = null;
}

function setPickHover(el) {
  if (pickHover === el) return;
  clearPickHover();
  if (!el || !el.style) return;
  pickHover = el;
  pickHover.__autoTestPrevOutline = el.style.outline;
  pickHover.__autoTestPrevOutlineOffset = el.style.outlineOffset;
  el.style.outline = '2px solid #2563eb';
  el.style.outlineOffset = '2px';
}

function setPickMode(on) {
  pickMode = !!on;
  document.documentElement.style.cursor = pickMode ? 'crosshair' : '';
  if (!pickMode) clearPickHover();
  if (pickMode) ensurePickBanner(); else removePickBanner();
}

// ---------- In-page UI: pick banner + comment overlay ----------
let pickBanner = null;
function ensurePickBanner() {
  if (pickBanner) return;
  pickBanner = document.createElement('div');
  pickBanner.id = '__auto_test_pick_banner__';
  Object.assign(pickBanner.style, {
    position: 'fixed', top: '12px', left: '50%', transform: 'translateX(-50%)',
    background: '#2563eb', color: 'white', padding: '8px 14px',
    borderRadius: '6px', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
    fontSize: '12px', zIndex: '2147483647', boxShadow: '0 6px 16px rgba(0,0,0,0.25)',
    pointerEvents: 'none', fontWeight: '600',
  });
  pickBanner.textContent = '🎯 Click an element to comment · Esc to cancel';
  document.documentElement.appendChild(pickBanner);
}
function removePickBanner() {
  if (!pickBanner) return;
  pickBanner.remove();
  pickBanner = null;
}

let commentOverlay = null;
function showCommentOverlay(target, locLabel) {
  removeCommentOverlay();
  const wrap = document.createElement('div');
  wrap.id = '__auto_test_comment_overlay__';
  Object.assign(wrap.style, {
    position: 'fixed', inset: '0', zIndex: '2147483647',
    background: 'rgba(15, 23, 42, 0.45)', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
  });
  const card = document.createElement('div');
  Object.assign(card.style, {
    background: 'white', padding: '16px 18px', borderRadius: '8px',
    width: 'min(520px, 92vw)', boxShadow: '0 16px 48px rgba(0,0,0,0.35)',
  });
  const head = document.createElement('div');
  head.textContent = 'Add a comment for the selected element';
  Object.assign(head.style, { fontSize: '13px', fontWeight: '700', marginBottom: '4px', color: '#111827' });
  const sub = document.createElement('div');
  sub.textContent = locLabel || '';
  Object.assign(sub.style, {
    fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: '11px',
    color: '#0f766e', marginBottom: '10px', wordBreak: 'break-all',
  });
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Describe the bug or behavior…';
  Object.assign(input.style, {
    width: '100%', padding: '8px 10px', border: '1px solid #93c5fd',
    borderRadius: '4px', fontSize: '13px', outline: 'none',
  });
  const row = document.createElement('div');
  Object.assign(row.style, { display: 'flex', gap: '8px', marginTop: '10px', justifyContent: 'flex-end' });
  const skip = document.createElement('button');
  skip.textContent = 'Skip';
  Object.assign(skip.style, btnStyle());
  const save = document.createElement('button');
  save.textContent = 'Save';
  Object.assign(save.style, primaryBtnStyle());

  card.appendChild(head);
  card.appendChild(sub);
  card.appendChild(input);
  row.appendChild(skip);
  row.appendChild(save);
  card.appendChild(row);
  wrap.appendChild(card);
  document.documentElement.appendChild(wrap);
  commentOverlay = wrap;
  setTimeout(() => input.focus(), 0);

  const finish = (commit) => {
    const note = commit ? input.value.trim() : '';
    removeCommentOverlay();
    if (note) {
      sendBg({ type: 'RECORDER_PICK_ELEMENT', target, note, pageUrl: location.href });
    }
    // Re-arm pick mode (sticky like the Electron app). The background will
    // also re-send SET_PICK_MODE after saving the comment, but doing it here
    // keeps the cursor crosshair across the small async gap.
    if (pickMode) setPickMode(true);
  };

  save.addEventListener('click', () => finish(true));
  skip.addEventListener('click', () => finish(false));
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
    else if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
  });
}
function removeCommentOverlay() {
  if (!commentOverlay) return;
  commentOverlay.remove();
  commentOverlay = null;
}
function btnStyle() {
  return {
    padding: '6px 12px', border: '1px solid #d1d5db', background: '#f9fafb',
    borderRadius: '4px', cursor: 'pointer', fontSize: '12px',
  };
}
function primaryBtnStyle() {
  return {
    padding: '6px 12px', border: '1px solid #2563eb', background: '#2563eb',
    color: 'white', borderRadius: '4px', cursor: 'pointer',
    fontSize: '12px', fontWeight: '600',
  };
}

// ---------- Event listeners ----------
document.addEventListener('mousemove', (ev) => {
  if (!pickMode) return;
  setPickHover(resolveInteractive(ev) || resolveTarget(ev));
}, true);

document.addEventListener('click', (ev) => {
  if (pickMode) {
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();
    const t = resolveInteractive(ev) || resolveTarget(ev);
    if (t) {
      const cand = extractCandidate(t);
      // Pause pick mode visuals while overlay is up; sticky restored by finish().
      pickMode = false;
      document.documentElement.style.cursor = '';
      clearPickHover();
      removePickBanner();
      showCommentOverlay(cand, locatorLabel(cand));
    }
    return;
  }
  const t = resolveInteractive(ev);
  if (!t) return;
  if (t.tagName === 'INPUT') {
    if (t.type === 'checkbox') {
      sendStep({ type: t.checked ? 'check' : 'uncheck', target: extractCandidate(t) });
      return;
    }
    if (t.type === 'radio') {
      sendStep({ type: 'check', target: extractCandidate(t) });
      return;
    }
  }
  sendStep({ type: 'click', target: extractCandidate(t) });
}, true);

document.addEventListener('input', (ev) => {
  if (pickMode) return;
  const t = resolveInteractive(ev);
  if (!t || !isEditable(t)) return;
  sendStep({ type: 'fill', target: extractCandidate(t), text: readEditableValue(t) });
}, true);

document.addEventListener('change', (ev) => {
  if (pickMode) return;
  const t = resolveInteractive(ev);
  if (!t) return;
  if (t.tagName === 'SELECT') {
    sendStep({ type: 'select', target: extractCandidate(t), selectValue: t.value });
  }
}, true);

document.addEventListener('keydown', (ev) => {
  if (pickMode && ev.key === 'Escape') {
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();
    setPickMode(false);
    sendBg({ type: 'RECORDER_PICK_CANCELLED' });
    return;
  }
  if (pickMode) return;
  if (ev.key !== 'Enter' && ev.key !== 'Tab' && ev.key !== 'Escape') return;
  const t = resolveInteractive(ev);
  if (!t) return;
  sendStep({ type: 'press', target: extractCandidate(t), key: ev.key });
}, true);

// ---------- Runtime issue probe ----------
window.addEventListener(RUNTIME_EVENT, (ev) => {
  if (!ev || !ev.detail || !ev.detail.kind) return;
  sendBg({ type: 'RUNTIME_ISSUE', kind: ev.detail.kind, payload: ev.detail.payload || {} });
}, true);

window.addEventListener('error', (ev) => {
  const target = ev.target;
  if (target && target !== window && target.nodeType === 1) {
    const url = target.currentSrc || target.src || target.href || '';
    sendBg({ type: 'RUNTIME_ISSUE', kind: 'network', payload: {
      source: 'resource', url, resourceType: target.tagName ? target.tagName.toLowerCase() : 'resource',
      error: 'resource failed to load',
    } });
    return;
  }
  sendBg({ type: 'RUNTIME_ISSUE', kind: 'page', payload: {
    message: ev.message || 'Script error',
    source: ev.filename ? `${ev.filename}:${ev.lineno || 0}:${ev.colno || 0}` : 'window.error',
    stack: ev.error && ev.error.stack ? ev.error.stack : undefined,
  } });
}, true);

window.addEventListener('unhandledrejection', (ev) => {
  const reason = ev.reason;
  const message = typeof reason === 'string'
    ? reason
    : reason && reason.message ? reason.message : String(reason);
  sendBg({ type: 'RUNTIME_ISSUE', kind: 'page', payload: {
    message, source: 'unhandledrejection',
    stack: reason && reason.stack ? reason.stack : undefined,
  } });
}, true);

function injectProbe() {
  const code = `
    (function () {
      if (window.__AUTO_TEST_PROBE__) return;
      window.__AUTO_TEST_PROBE__ = true;
      var EVT = ${JSON.stringify(RUNTIME_EVENT)};
      function emit(kind, payload) {
        window.dispatchEvent(new CustomEvent(EVT, { detail: { kind: kind, payload: payload } }));
      }
      if (typeof window.fetch === 'function') {
        var orig = window.fetch;
        window.fetch = function () {
          var args = Array.prototype.slice.call(arguments);
          var input = args[0];
          var init = args[1] || {};
          var url = typeof input === 'string' ? input : (input && input.url) || '';
          var method = init.method || (input && input.method) || 'GET';
          return orig.apply(this, args).then(function (resp) {
            if (!resp.ok) emit('network', {
              source: 'fetch', url: resp.url || url, method: method,
              status: resp.status, statusText: resp.statusText,
            });
            return resp;
          }).catch(function (err) {
            emit('network', {
              source: 'fetch', url: url, method: method,
              error: String(err && err.message || err),
            });
            throw err;
          });
        };
      }
      if (window.XMLHttpRequest && window.XMLHttpRequest.prototype) {
        var open = window.XMLHttpRequest.prototype.open;
        var send = window.XMLHttpRequest.prototype.send;
        window.XMLHttpRequest.prototype.open = function (method, url) {
          this.__autoTestReq = { method: method || 'GET', url: String(url || '') };
          return open.apply(this, arguments);
        };
        window.XMLHttpRequest.prototype.send = function () {
          var xhr = this;
          var meta = xhr.__autoTestReq || { method: 'GET', url: '' };
          xhr.addEventListener('loadend', function () {
            if (xhr.status >= 400) emit('network', {
              source: 'xhr', url: xhr.responseURL || meta.url, method: meta.method,
              status: xhr.status, statusText: xhr.statusText,
            });
          }, { once: true });
          xhr.addEventListener('error', function () {
            emit('network', {
              source: 'xhr', url: xhr.responseURL || meta.url, method: meta.method,
              error: 'XMLHttpRequest failed',
            });
          }, { once: true });
          return send.apply(this, arguments);
        };
      }
      ['error', 'warn'].forEach(function (level) {
        var origCons = console[level];
        console[level] = function () {
          try {
            var msg = Array.prototype.map.call(arguments, function (a) {
              if (typeof a === 'string') return a;
              try { return JSON.stringify(a); } catch (e) { return String(a); }
            }).join(' ');
            emit('console', { level: level === 'warn' ? 'warning' : 'error', message: msg });
          } catch (e) {}
          return origCons.apply(this, arguments);
        };
      });
    })();
  `;
  const inject = () => {
    const root = document.documentElement || document.head || document.body;
    if (!root) return false;
    const s = document.createElement('script');
    s.textContent = code;
    root.appendChild(s);
    s.remove();
    return true;
  };
  if (!inject()) {
    document.addEventListener('readystatechange', () => { inject(); }, { once: true });
  }
}
injectProbe();

// ---------- Background-pushed state ----------
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || !msg.type) return;
  if (msg.type === 'SET_ENABLED') enabled = !!msg.enabled;
  if (msg.type === 'SET_PICK_MODE') setPickMode(!!msg.pickMode);
});

// On load, ask the background what mode this tab should be in.
try {
  chrome.runtime.sendMessage({ type: 'RECORDER_PING' }, (resp) => {
    if (!resp) return;
    if (typeof resp.enabled === 'boolean') enabled = resp.enabled;
    if (typeof resp.pickMode === 'boolean') setPickMode(resp.pickMode);
  });
} catch {}

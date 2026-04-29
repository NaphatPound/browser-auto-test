const { ipcRenderer } = require('electron');

const DEFAULT_ATTRS = ['data-testid', 'id', 'name', 'aria-label', 'role', 'type', 'placeholder'];
const RUNTIME_EVENT = '__auto_test_runtime_issue__';

let pickMode = false;
let pickHoverEl = null;

function cssPath(el) {
  const parts = [];
  let cur = el;
  // Walk all the way up looking for an ancestor with an id (anchor the
  // selector there) or hit the documentElement. No 5-level cap: deep pages
  // often need more context to disambiguate.
  while (cur && cur.nodeType === 1) {
    let seg = cur.tagName.toLowerCase();
    if (cur.id) {
      seg += '#' + CSS.escape(cur.id);
      parts.unshift(seg);
      return parts.join(' > ');
    }
    const parent = cur.parentElement;
    if (parent) {
      const sameTag = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
      if (sameTag.length > 1) {
        const idx = sameTag.indexOf(cur) + 1;
        seg += ':nth-of-type(' + idx + ')';
      }
    }
    parts.unshift(seg);
    cur = parent;
  }
  return parts.join(' > ');
}

function extractCandidate(el) {
  const attrs = {};
  for (const n of DEFAULT_ATTRS) {
    const v = el.getAttribute(n);
    if (v != null) attrs[n] = v;
  }
  // Skip textContent-as-locator for editable elements — their "text" is the
  // user's typed value and mutates with every keystroke, so the locator would
  // be unstable (and adjacent fills would never collapse).
  const rawText = isEditable(el) ? '' : (el.textContent || '').trim();
  return {
    attrs,
    tag: el.tagName.toLowerCase(),
    text: rawText.length > 0 && rawText.length < 80 ? rawText : undefined,
    cssSelector: cssPath(el),
  };
}

// Keep this in sync with src/inject.ts isEditable / readEditableValue.
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
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
    return el.value || '';
  }
  return el.textContent || '';
}

// Walk composedPath() so controls inside an open shadow root are reached —
// ev.target is retargeted to the host for composed events.
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
  'button', 'link', 'checkbox', 'radio', 'menuitem', 'tab', 'option', 'switch',
  'textbox', 'combobox', 'searchbox',
]);

function isInteractive(el) {
  if (!el || !el.tagName) return false;
  if (INTERACTIVE_TAGS.has(el.tagName)) return true;
  const role = el.getAttribute && el.getAttribute('role');
  if (role && INTERACTIVE_ROLES.has(role)) return true;
  if (el.hasAttribute && el.hasAttribute('onclick')) return true;
  return false;
}

/**
 * Resolve the element that should "own" this event. Three promotions:
 *   1. Outermost contenteditable ancestor (so editor-inner <p> becomes the root)
 *   2. Nearest interactive ancestor (so <svg> inside <button> becomes the button)
 *   3. Input/textarea used directly
 */
function resolveInteractive(ev) {
  const t = resolveTarget(ev);
  if (!t) return null;
  if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return t;

  // Prefer the outermost contenteditable ancestor — attributes like
  // role="textbox"/aria-label typically live on the editor root.
  let outermost = null;
  let cur = t;
  while (cur) {
    const ce = cur.getAttribute ? cur.getAttribute('contenteditable') : null;
    if (ce === '' || ce === 'true' || ce === 'plaintext-only') outermost = cur;
    cur = cur.parentElement;
  }
  if (outermost) return outermost;

  // For interaction events, walk up to the nearest interactive ancestor
  // (<button>, <a>, [role="button"], …) so clicking an icon/svg records
  // against the button the user actually meant to click.
  if (ev.type === 'click' || ev.type === 'keydown') {
    let anc = t;
    while (anc && anc !== document.body && anc !== document.documentElement) {
      if (isInteractive(anc)) return anc;
      anc = anc.parentElement;
    }
  }

  return t;
}

let enabled = false;

ipcRenderer.on('recorder:set-enabled', (_e, value) => {
  enabled = !!value;
});

function send(step) {
  if (!enabled) return;
  ipcRenderer.sendToHost('recorder:step', step);
}

function sendRuntimeIssue(kind, payload) {
  ipcRenderer.sendToHost('telemetry:issue', { kind, payload });
}

function clearPickHover() {
  if (!pickHoverEl) return;
  pickHoverEl.style.outline = pickHoverEl.__autoTestPrevOutline || '';
  pickHoverEl.style.outlineOffset = pickHoverEl.__autoTestPrevOutlineOffset || '';
  pickHoverEl = null;
}

function setPickHover(el) {
  if (pickHoverEl === el) return;
  clearPickHover();
  if (!el || !el.style) return;
  pickHoverEl = el;
  pickHoverEl.__autoTestPrevOutline = pickHoverEl.style.outline;
  pickHoverEl.__autoTestPrevOutlineOffset = pickHoverEl.style.outlineOffset;
  pickHoverEl.style.outline = '2px solid #2563eb';
  pickHoverEl.style.outlineOffset = '2px';
}

function setPickMode(value) {
  pickMode = !!value;
  document.documentElement.style.cursor = pickMode ? 'crosshair' : '';
  if (!pickMode) clearPickHover();
}

ipcRenderer.on('inspector:pick-mode', (_e, value) => {
  setPickMode(value);
});

document.addEventListener(
  'mousemove',
  (ev) => {
    if (!pickMode) return;
    setPickHover(resolveInteractive(ev) || resolveTarget(ev));
  },
  true,
);

document.addEventListener(
  'click',
  (ev) => {
    if (pickMode) {
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();
      const t = resolveInteractive(ev) || resolveTarget(ev);
      if (t) {
        ipcRenderer.sendToHost('inspector:pick-element', { target: extractCandidate(t) });
      }
      setPickMode(false);
      return;
    }
    const t = resolveInteractive(ev);
    if (!t) return;
    if (t.tagName === 'INPUT') {
      if (t.type === 'checkbox') {
        send({ type: t.checked ? 'check' : 'uncheck', target: extractCandidate(t) });
        return;
      }
      if (t.type === 'radio') {
        send({ type: 'check', target: extractCandidate(t) });
        return;
      }
    }
    send({ type: 'click', target: extractCandidate(t) });
  },
  true,
);

document.addEventListener(
  'input',
  (ev) => {
    if (pickMode) return;
    const t = resolveInteractive(ev);
    if (!t || !isEditable(t)) return;
    send({ type: 'fill', target: extractCandidate(t), text: readEditableValue(t) });
  },
  true,
);

document.addEventListener(
  'change',
  (ev) => {
    if (pickMode) return;
    const t = resolveInteractive(ev);
    if (!t) return;
    if (t.tagName === 'SELECT') {
      send({ type: 'select', target: extractCandidate(t), selectValue: t.value });
    }
  },
  true,
);

document.addEventListener(
  'keydown',
  (ev) => {
    if (pickMode && ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();
      setPickMode(false);
      ipcRenderer.sendToHost('inspector:pick-cancelled');
      return;
    }
    if (pickMode) return;
    if (ev.key !== 'Enter' && ev.key !== 'Tab' && ev.key !== 'Escape') return;
    const t = resolveInteractive(ev);
    if (!t) return;
    send({ type: 'press', target: extractCandidate(t), key: ev.key });
  },
  true,
);

window.addEventListener(
  RUNTIME_EVENT,
  (ev) => {
    if (!ev || !ev.detail || !ev.detail.kind) return;
    sendRuntimeIssue(ev.detail.kind, ev.detail.payload || {});
  },
  true,
);

window.addEventListener(
  'error',
  (ev) => {
    const target = ev.target;
    if (target && target !== window && target.nodeType === 1) {
      const url = target.currentSrc || target.src || target.href || '';
      sendRuntimeIssue('network', {
        source: 'resource',
        url,
        resourceType: target.tagName ? target.tagName.toLowerCase() : 'resource',
        error: 'resource failed to load',
      });
      return;
    }
    const source = ev.filename
      ? `${ev.filename}:${ev.lineno || 0}:${ev.colno || 0}`
      : 'window.error';
    sendRuntimeIssue('page', {
      message: ev.message || 'Script error',
      source,
      stack: ev.error && ev.error.stack ? ev.error.stack : undefined,
    });
  },
  true,
);

window.addEventListener(
  'unhandledrejection',
  (ev) => {
    const reason = ev.reason;
    const message = typeof reason === 'string'
      ? reason
      : reason && reason.message
        ? reason.message
        : String(reason);
    sendRuntimeIssue('page', {
      message,
      source: 'unhandledrejection',
      stack: reason && reason.stack ? reason.stack : undefined,
    });
  },
  true,
);

function injectRuntimeProbe() {
  const source = `
    (function () {
      if (window.__AUTO_TEST_RUNTIME_MONITOR__) return;
      window.__AUTO_TEST_RUNTIME_MONITOR__ = true;
      var eventName = ${JSON.stringify(RUNTIME_EVENT)};
      function emit(kind, payload) {
        window.dispatchEvent(new CustomEvent(eventName, { detail: { kind: kind, payload: payload } }));
      }
      if (typeof window.fetch === 'function') {
        var origFetch = window.fetch;
        window.fetch = function () {
          var args = Array.prototype.slice.call(arguments);
          var input = args[0];
          var init = args[1] || {};
          var url = typeof input === 'string' ? input : (input && input.url) || '';
          var method = init.method || (input && input.method) || 'GET';
          var startTs = Date.now();
          return origFetch.apply(this, args).then(function (response) {
            var trace = {
              source: 'fetch',
              url: response.url || url,
              method: method,
              status: response.status,
              statusText: response.statusText,
              ok: response.ok,
              durationMs: Date.now() - startTs
            };
            emit('net', trace);
            if (!response.ok) {
              emit('network', {
                source: 'fetch',
                url: response.url || url,
                method: method,
                status: response.status,
                statusText: response.statusText
              });
            }
            return response;
          }).catch(function (error) {
            var msg = String(error && error.message || error);
            emit('net', {
              source: 'fetch',
              url: url,
              method: method,
              ok: false,
              error: msg,
              durationMs: Date.now() - startTs
            });
            emit('network', {
              source: 'fetch',
              url: url,
              method: method,
              error: msg
            });
            throw error;
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
          var startTs = Date.now();
          xhr.addEventListener('loadend', function onLoadEnd() {
            emit('net', {
              source: 'xhr',
              url: xhr.responseURL || meta.url,
              method: meta.method,
              status: xhr.status,
              statusText: xhr.statusText,
              ok: xhr.status >= 200 && xhr.status < 400,
              durationMs: Date.now() - startTs
            });
            if (xhr.status >= 400) {
              emit('network', {
                source: 'xhr',
                url: xhr.responseURL || meta.url,
                method: meta.method,
                status: xhr.status,
                statusText: xhr.statusText
              });
            }
          }, { once: true });
          xhr.addEventListener('error', function onError() {
            emit('network', {
              source: 'xhr',
              url: xhr.responseURL || meta.url,
              method: meta.method,
              error: 'XMLHttpRequest failed'
            });
          }, { once: true });
          return send.apply(this, arguments);
        };
      }
    })();
  `;

  const inject = () => {
    const root = document.documentElement || document.head || document.body;
    if (!root) return false;
    const script = document.createElement('script');
    script.textContent = source;
    root.appendChild(script);
    script.remove();
    return true;
  };

  if (!inject()) {
    document.addEventListener(
      'readystatechange',
      () => {
        inject();
      },
      { once: true },
    );
  }
}

injectRuntimeProbe();

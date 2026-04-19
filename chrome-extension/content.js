'use strict';

// Port of app/webview-preload.cjs — event capture + locator extraction,
// sending each recorded step to the background service worker via
// chrome.runtime.sendMessage. The background worker owns state.

const DEFAULT_ATTRS = ['data-testid', 'id', 'name', 'aria-label', 'role', 'type', 'placeholder'];

let enabled = false;

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
      if (sameTag.length > 1) {
        seg += ':nth-of-type(' + (sameTag.indexOf(cur) + 1) + ')';
      }
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

function send(step) {
  if (!enabled) return;
  try {
    chrome.runtime.sendMessage({ type: 'RECORDER_STEP', step });
  } catch (e) {
    // Extension context invalidated (e.g., after reload) — silently drop.
  }
}

document.addEventListener(
  'click',
  (ev) => {
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
    const t = resolveInteractive(ev);
    if (!t || !isEditable(t)) return;
    send({ type: 'fill', target: extractCandidate(t), text: readEditableValue(t) });
  },
  true,
);

document.addEventListener(
  'change',
  (ev) => {
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
    if (ev.key !== 'Enter' && ev.key !== 'Tab' && ev.key !== 'Escape') return;
    const t = resolveInteractive(ev);
    if (!t) return;
    send({ type: 'press', target: extractCandidate(t), key: ev.key });
  },
  true,
);

// Sync enabled state with the background on load and on change.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'SET_ENABLED') {
    enabled = !!msg.enabled;
  }
});

chrome.runtime.sendMessage({ type: 'RECORDER_PING' }, (resp) => {
  if (resp && typeof resp.enabled === 'boolean') enabled = resp.enabled;
});

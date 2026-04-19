import type { Recorder } from './recorder.js';
import type { LocatorCandidate } from './locator.js';

export interface InjectOptions {
  recorder: Recorder;
  /** Document to attach to. Defaults to global document (browser only). */
  document?: Document;
  /** Attributes to lift onto the LocatorCandidate. Defaults to common ones. */
  attrNames?: string[];
}

const DEFAULT_ATTRS = ['data-testid', 'id', 'name', 'aria-label', 'role', 'type', 'placeholder'];

/** Build a stable-ish CSS selector from an element (fallback only). */
export function cssPath(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.nodeType === 1 && parts.length < 5) {
    let seg = cur.tagName.toLowerCase();
    if (cur.id) {
      seg += `#${cur.id}`;
      parts.unshift(seg);
      break;
    }
    const parent: Element | null = cur.parentElement;
    if (parent) {
      const tag = cur.tagName;
      const sameTag: Element[] = Array.from(parent.children).filter(
        (c: Element) => c.tagName === tag,
      );
      if (sameTag.length > 1) {
        const idx = sameTag.indexOf(cur) + 1;
        seg += `:nth-of-type(${idx})`;
      }
    }
    parts.unshift(seg);
    cur = parent;
  }
  return parts.join(' > ');
}

/** Extract a LocatorCandidate from a DOM element. Pure — exported for tests. */
export function extractCandidate(el: Element, attrNames: string[] = DEFAULT_ATTRS): LocatorCandidate {
  const attrs: Record<string, string | undefined> = {};
  for (const n of attrNames) {
    const v = el.getAttribute(n);
    if (v != null) attrs[n] = v;
  }
  // Editable targets: skip textContent — their "text" is the user's typed
  // value and mutates every keystroke, which makes the locator unstable.
  const rawText = isEditable(el) ? '' : (el.textContent ?? '').trim();
  return {
    attrs,
    tag: el.tagName.toLowerCase(),
    text: rawText.length > 0 ? rawText : undefined,
    cssSelector: cssPath(el),
  };
}

const isEditable = (el: Element): boolean => {
  const tag = el.tagName;
  if (tag === 'INPUT') {
    const t = (el as HTMLInputElement).type;
    return t !== 'checkbox' && t !== 'radio' && t !== 'submit' && t !== 'button';
  }
  if (tag === 'TEXTAREA') return true;
  const he = el as HTMLElement;
  if (he.isContentEditable === true) return true;
  const ce = el.getAttribute('contenteditable');
  return ce === '' || ce === 'true' || ce === 'plaintext-only';
};

const readEditableValue = (el: Element): string => {
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    return (el as HTMLInputElement | HTMLTextAreaElement).value ?? '';
  }
  return (el as HTMLElement).textContent ?? '';
};

/**
 * Resolve the original event source. For controls inside an open shadow root,
 * `ev.target` is retargeted to the host, so we walk `composedPath()` and take
 * the first element — that's the real inner control.
 */
const resolveTarget = (ev: Event): Element | null => {
  const path: EventTarget[] =
    typeof (ev as { composedPath?: () => EventTarget[] }).composedPath === 'function'
      ? (ev as { composedPath: () => EventTarget[] }).composedPath()
      : [];
  for (const n of path) {
    if (n && (n as Element).nodeType === 1) return n as Element;
  }
  const t = ev.target as Element | null;
  return t && t.nodeType === 1 ? t : null;
};

/**
 * If the resolved target is inside a contenteditable region, bubble up to the
 * editor root so locators attach to the editor itself (which typically carries
 * stable attributes like `role="textbox"` or `aria-label`), not inner
 * formatting elements like `<p>` or `<span>`.
 */
const resolveInteractive = (ev: Event): Element | null => {
  const t = resolveTarget(ev);
  if (!t) return null;
  if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return t;
  // Walk ancestors (inclusive) looking for the outermost element with a
  // `contenteditable` attribute set — that's the editor root. Using the
  // attribute directly is more reliable than `isContentEditable`, which has
  // patchy ancestor-inheritance behavior outside real browsers.
  let outermost: Element | null = null;
  let cur: Element | null = t;
  while (cur) {
    const ce = cur.getAttribute ? cur.getAttribute('contenteditable') : null;
    if (ce === '' || ce === 'true' || ce === 'plaintext-only') outermost = cur;
    cur = cur.parentElement;
  }
  return outermost ?? t;
};

/**
 * Attach DOM listeners that feed the Recorder. Returns a cleanup function.
 * Events: click, input (fill), change (select/checkbox), keydown (enter/tab).
 */
export function attach(opts: InjectOptions): () => void {
  const doc = opts.document ?? (globalThis as { document?: Document }).document;
  if (!doc) {
    throw new Error('attach(): no document available (pass opts.document in non-browser env)');
  }
  const { recorder } = opts;
  const attrs = opts.attrNames ?? DEFAULT_ATTRS;

  const onClick = (ev: Event): void => {
    const t = resolveInteractive(ev);
    if (!t) return;
    if (t.tagName === 'INPUT') {
      const input = t as HTMLInputElement;
      if (input.type === 'checkbox') {
        recorder.capture(input.checked ? 'check' : 'uncheck', extractCandidate(t, attrs));
        return;
      }
      if (input.type === 'radio') {
        recorder.capture('check', extractCandidate(t, attrs));
        return;
      }
    }
    recorder.capture('click', extractCandidate(t, attrs));
  };

  const onInput = (ev: Event): void => {
    const t = resolveInteractive(ev);
    if (!t || !isEditable(t)) return;
    recorder.capture('fill', extractCandidate(t, attrs), { text: readEditableValue(t) });
  };

  const onChange = (ev: Event): void => {
    const t = resolveInteractive(ev);
    if (!t) return;
    if (t.tagName === 'SELECT') {
      const sel = t as HTMLSelectElement;
      recorder.capture('select', extractCandidate(t, attrs), { selectValue: sel.value });
    }
  };

  const onKeydown = (ev: Event): void => {
    const ke = ev as KeyboardEvent;
    if (ke.key !== 'Enter' && ke.key !== 'Tab' && ke.key !== 'Escape') return;
    const t = resolveInteractive(ev);
    if (!t) return;
    recorder.capture('press', extractCandidate(t, attrs), { key: ke.key });
  };

  doc.addEventListener('click', onClick, true);
  doc.addEventListener('input', onInput, true);
  doc.addEventListener('change', onChange, true);
  doc.addEventListener('keydown', onKeydown, true);

  return () => {
    doc.removeEventListener('click', onClick, true);
    doc.removeEventListener('input', onInput, true);
    doc.removeEventListener('change', onChange, true);
    doc.removeEventListener('keydown', onKeydown, true);
  };
}

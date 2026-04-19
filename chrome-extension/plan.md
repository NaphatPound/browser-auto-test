# Plan: Chrome Extension Recorder for browser-auto-test

## Objective

Build a Chrome Extension (Manifest V3) that records user actions — clicks,
typing, selects, navigations — and exports them as a JSON file that matches
the core engine's `TestSuite` schema so the captured flow can be replayed
or converted to Playwright / Cypress / Puppeteer code with no translation
layer.

The extension reuses the same event-capture semantics as `src/inject.ts`
and `app/webview-preload.cjs`: `composedPath` to pierce shadow DOM,
contenteditable-root promotion, nearest-interactive-ancestor for clicks,
and a textContent-as-locator suppression for editable targets.

## Project Structure

```text
chrome-extension/
├── manifest.json   # MV3 manifest (permissions, action, content script)
├── background.js   # Service worker — state, storage, downloads, nav tracking
├── content.js      # DOM listeners + locator extraction (port of inject.ts)
├── popup.html      # Popup UI shell
├── popup.js        # Popup logic (Start / Stop / Clear / Download)
├── styles.css      # Popup styling
└── plan.md         # This file
```

## Message-Passing Protocol

```
┌─────────────┐  chrome.runtime.sendMessage  ┌─────────────┐
│  content.js │  ─────────────────────────▶  │ background  │
└─────────────┘        RECORDER_STEP         └─────────────┘
                                                    │
                                                    │ chrome.storage.local
                                                    ▼
                                               persisted state
                                                    ▲
                                                    │ chrome.runtime.onMessage
                                                    │
┌─────────────┐  chrome.runtime.sendMessage  ┌─────────────┐
│   popup.js  │  ─────────────────────────▶  │ background  │
└─────────────┘   START / STOP / CLEAR       └─────────────┘
                  GET_STATE / EXPORT
```

### Message types

| Direction          | Type               | Payload                                      |
|--------------------|--------------------|----------------------------------------------|
| content → bg       | `RECORDER_STEP`    | `{ step }` — partial `Step` (type + target)  |
| content → bg       | `RECORDER_PING`    | `{}` — does the page need recording enabled? |
| popup → bg         | `START_RECORDING`  | `{ baseUrl? }`                               |
| popup → bg         | `STOP_RECORDING`   | `{}`                                         |
| popup → bg         | `CLEAR_STEPS`      | `{}`                                         |
| popup → bg         | `GET_STATE`        | `{}` → returns `{ recording, steps }`        |
| popup → bg         | `EXPORT_SUITE`     | `{ name? }` → triggers download              |
| bg → all tabs      | `SET_ENABLED`      | `{ enabled }` — toggle capture on/off        |
| bg → popup (push)  | `STATE_CHANGED`    | `{ recording, steps }`                       |

## JSON Output Schema

Must match `src/types.ts#TestSuite` exactly:

```json
{
  "name": "recorded flow",
  "baseUrl": "https://example.com",
  "steps": [
    { "id": "step_1_...", "type": "navigate", "url": "https://example.com/login" },
    { "id": "step_2_...", "type": "click",    "locator": { "strategy": "testId", "value": "submit" } },
    { "id": "step_3_...", "type": "fill",     "locator": { "strategy": "name",   "value": "username" }, "text": "alice" },
    { "id": "step_4_...", "type": "press",    "locator": { "strategy": "name",   "value": "username" }, "key": "Enter" },
    { "id": "step_5_...", "type": "select",   "locator": { "strategy": "id",     "value": "country"  }, "selectValue": "TH" },
    { "id": "step_6_...", "type": "wait",     "timeoutMs": 500 }
  ],
  "createdAt": "2026-04-20T00:00:00.000Z"
}
```

## Reference — Core capture logic (`src/inject.ts`)

Keep the Chrome extension's `content.js` behaviorally identical to the core
injector. The three key helpers below are the contract.

### Locator-priority extraction

```ts
// src/locator.ts — Smart Locator priority.
export function pickLocator(el: LocatorCandidate): Locator {
  const a = el.attrs ?? {};
  if (a['data-testid'])  return { strategy: 'testId',    value: a['data-testid'] };
  if (a['aria-label'])   return { strategy: 'ariaLabel', value: a['aria-label']  };
  if (a.name)            return { strategy: 'name',      value: a.name           };
  if (a.id)              return { strategy: 'id',        value: a.id             };
  if (el.text && el.text.length > 0 && el.text.length < 80) {
    return { strategy: 'text', value: el.text.trim() };
  }
  if (el.cssSelector)    return { strategy: 'css', value: el.cssSelector };
  return { strategy: 'css', value: el.tag ?? '*' };
}
```

### Candidate extraction (attrs + CSS fallback)

```ts
// src/inject.ts
const DEFAULT_ATTRS = ['data-testid', 'id', 'name', 'aria-label',
                       'role', 'type', 'placeholder'];

export function extractCandidate(el: Element, attrNames = DEFAULT_ATTRS) {
  const attrs: Record<string, string | undefined> = {};
  for (const n of attrNames) {
    const v = el.getAttribute(n);
    if (v != null) attrs[n] = v;
  }
  // Skip textContent for editable targets — the "text" is the user's typed
  // value and would produce a circular locator (bug06).
  const rawText = isEditable(el) ? '' : (el.textContent ?? '').trim();
  return {
    attrs,
    tag: el.tagName.toLowerCase(),
    text: rawText.length > 0 ? rawText : undefined,
    cssSelector: cssPath(el),
  };
}
```

### Stable-ish CSS path (anchors on the nearest ancestor `id`)

```ts
// src/inject.ts
export function cssPath(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.nodeType === 1) {
    let seg = cur.tagName.toLowerCase();
    if (cur.id) { parts.unshift(seg + '#' + CSS.escape(cur.id)); break; }
    const parent = cur.parentElement;
    if (parent) {
      const sameTag = Array.from(parent.children).filter(c => c.tagName === cur!.tagName);
      if (sameTag.length > 1) seg += ':nth-of-type(' + (sameTag.indexOf(cur) + 1) + ')';
    }
    parts.unshift(seg);
    cur = parent;
  }
  return parts.join(' > ');
}
```

### Editable detection (INPUT / TEXTAREA / contenteditable)

```ts
// src/inject.ts
const isEditable = (el: Element): boolean => {
  const tag = el.tagName;
  if (tag === 'INPUT') {
    const t = (el as HTMLInputElement).type;
    return t !== 'checkbox' && t !== 'radio' && t !== 'submit' && t !== 'button';
  }
  if (tag === 'TEXTAREA') return true;
  if ((el as HTMLElement).isContentEditable === true) return true;
  const ce = el.getAttribute('contenteditable');
  return ce === '' || ce === 'true' || ce === 'plaintext-only';
};
```

### Resolve the real target (shadow DOM + contenteditable root + interactive ancestor)

```ts
const resolveInteractive = (ev: Event): Element | null => {
  const t = resolveTarget(ev);            // walks composedPath() for shadow DOM
  if (!t) return null;
  if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return t;

  // 1. Editor root wins: <div contenteditable><p>text</p></div>
  let editRoot: Element | null = null;
  for (let c: Element | null = t; c; c = c.parentElement) {
    const ce = c.getAttribute?.('contenteditable');
    if (ce === '' || ce === 'true' || ce === 'plaintext-only') editRoot = c;
  }
  if (editRoot) return editRoot;

  // 2. For clicks/keys, bubble to nearest <button>/<a>/[role=...] ancestor
  if (ev.type === 'click' || ev.type === 'keydown') {
    for (let c: Element | null = t; c && c !== document.body; c = c.parentElement) {
      if (isInteractive(c)) return c;
    }
  }
  return t;
};
```

### Event wiring

```ts
doc.addEventListener('click',   onClick,   true);
doc.addEventListener('input',   onInput,   true);   // → fill
doc.addEventListener('change',  onChange,  true);   // → select
doc.addEventListener('keydown', onKeydown, true);   // Enter/Tab/Escape → press
```

## Pipeline Safeguards (must be in content.js or background.js)

Translate these defenses from the Electron renderer to preserve replay
fidelity:

1. **`fill` must never use a `text` locator** — strip `candidate.text`
   before `pickLocator` when the event is `input`.
2. **Carry-forward** — if the previous non-wait step is a `click` or `fill`,
   reuse its locator for the next `fill` (clicks-to-focus-then-type).
3. **Adjacent-fill collapse** — on the same locator, merge keystrokes into
   one `fill` step with the latest text.
4. **Auto-wait (optional)** — if enabled, push a `wait` step after every
   non-wait step with a user-configurable duration.

## Navigation Tracking

Use `chrome.webNavigation.onCommitted` for full navigations (gives the URL).
For SPA route changes use `chrome.webNavigation.onHistoryStateUpdated`.
Filter to the active recorded tab. Emit a `navigate` step for each commit
that happens while `recording` is true.

## Implementation Workflow (AI-friendly)

1. Drop `manifest.json` — MV3 with `storage`, `activeTab`, `scripting`,
   `tabs`, `webNavigation`, `downloads` permissions and `<all_urls>` host.
2. Port `app/webview-preload.cjs` into `content.js`, replacing
   `ipcRenderer.sendToHost` with `chrome.runtime.sendMessage`.
3. Implement `background.js` as the state store using
   `chrome.storage.local` and the protocol above.
4. Build `popup.html` + `popup.js` with Start / Stop / Clear / Download.
5. Export uses `URL.createObjectURL(new Blob([json], {type:'application/json'}))`
   + `chrome.downloads.download({ url, filename })`.

## TestSuite cross-check

Before download, validate the payload shape:

```ts
const valid = suite
  && typeof suite.name === 'string'
  && Array.isArray(suite.steps)
  && suite.steps.every((s: any) => typeof s.id === 'string' && typeof s.type === 'string');
```

This matches `TestSuite` in `src/types.ts`. Invalid payloads should be
rejected with a user-visible error rather than silently downloaded.

# bug06: replay cannot find fill targets when recording falls back to a text-based locator derived from the typed value

## Severity
High

## Affected code
- `app/webview-preload.cjs:35-38`
- `app/webview-preload.cjs:48-63`
- `app/renderer.js:500-509`
- `app/renderer.js:571-577`
- `app/renderer.js:601-603`

## Summary
The record/replay pipeline can create `fill` steps whose locator is the user's typed text, for example:

```text
fill — text=c "c"
fill — text=ca "ca"
fill — text=cat "cat"
```

Replay then tries to find the element by searching the current DOM for an element whose `textContent` already equals `c`, `ca`, or `cat`.

That is circular for a fill action: the text usually does not exist until **after** the field has been filled, so replay fails with `element not found`.

This matches the provided log exactly:

- click step succeeds
- wait succeeds
- every fill step fails with `element not found`

## Root cause
### 1. Recording only suppresses text-based locators for a narrow set of editable elements
`app/webview-preload.cjs#extractCandidate()` intentionally avoids using `textContent` as a locator only when `isEditable(el)` returns true:

```js
const rawText = isEditable(el) ? '' : (el.textContent || '').trim();
```

But `isEditable()` only recognizes:

- `INPUT`
- `TEXTAREA`
- `contenteditable`

So if an input-like widget emits `input` events from some other element shape, its candidate keeps the current `textContent`.

### 2. Renderer re-picks the locator from that candidate
`app/renderer.js` receives the raw candidate and runs:

```js
const locator = pickLocator(raw.target || { attrs: {} });
```

Because `pickLocator()` prefers `text` over `css`, a fill event on such a widget can become:

```js
{ type: 'fill', locator: { strategy: 'text', value: 'c' }, text: 'c' }
```

### 3. Replay resolves `text` locators by current DOM text, not by the clicked field
`buildFinderExpr()` handles `text` locators by scanning `textContent`:

```js
if (loc.strategy === 'text') {
  // query all common text-bearing elements and match trimmed textContent
}
```

For a fill step, that means replay looks for an element whose current visible text is already `c` / `ca` / `cat` before it performs the fill.

If the field starts empty, replay can never find it.

## Reproduction
I reproduced the underlying behavior locally with the current code path using a generic `<div id="box"></div>`:

1. Before typing, the click target resolves to:

```json
{ "strategy": "css", "value": "div#box" }
```

2. After the element's text becomes `c`, the fill target resolves to:

```json
{ "strategy": "text", "value": "c" }
```

3. On a fresh replay state where the element text is empty again, the replay-side text finder cannot resolve that fill locator:

```json
{
  "clickLocator": { "strategy": "css", "value": "div#box" },
  "fillLocator": { "strategy": "text", "value": "c" },
  "replayCanFindFillTarget": false
}
```

## Why this explains the provided log
Your log shows:

```text
Step 1: click — css=div:nth-of-type(2) > div > div > div > div   ✓
Step 3: fill — text=c "c"                                        ✗ element not found
Step 5: fill — text=ca "ca"                                      ✗ element not found
Step 7: fill — text=cat "cat"                                    ✗ element not found
```

That is the signature of this bug:

- the initial click uses a structural CSS locator and succeeds
- subsequent fill events are recorded against the evolving typed text
- replay searches for that text in the pre-fill DOM and fails every time

## User impact
- Replay is unreliable for custom text-entry widgets that are not recognized by `isEditable()`.
- The more the user types, the worse the recorded suite gets, because each fill step points at a transient value rather than a stable control.
- Generated code and replay diverge from the user's mental model: "type into the field I just clicked".

## Recommended fix
- Broaden editable-target detection in `app/webview-preload.cjs` so input-like widgets do not fall back to `textContent` locators.
- Never allow `fill` steps to use a `text` locator based on the just-typed value.
- Prefer carrying forward the structural locator from the clicked/focused element for subsequent fills on the same control.
- Add replay-focused tests for:
  - a custom widget that emits `input`
  - a recorded sequence `click -> fill("c") -> fill("ca") -> fill("cat")`
  - verification that replay can still resolve the same element on a fresh page state

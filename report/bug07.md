# bug07: replay writes typed text onto a wrapper/container instead of the real input control

## Severity
High

## Affected code
- `app/webview-preload.cjs:101-128`
- `app/renderer.js:626-628`

## Summary
The remaining replay bug is not just “element not found”. Even when replay **does** find an element for a `fill` step, it can find the wrong element: a wrapper `<div>` / container instead of the actual editable control.

When that happens, replay executes:

```js
if ('value' in el) {
  el.value = v;
} else {
  el.textContent = v;
}
```

So the typed text is rendered directly into the wrapper/container, which matches the symptom:

- text shows “over the top of the website”
- the real input field still is not filled

## Root cause
There are two parts to this bug:

### 1. Recording/replay can target a wrapper instead of the actual editable control
`app/webview-preload.cjs#resolveInteractive()` promotes:

- contenteditable roots
- interactive ancestors for clicks/keydown
- direct `INPUT` / `TEXTAREA`

But it does **not** normalize non-native “input-like” wrappers to an actual editable descendant.

So for composite controls or styled inputs, the recorded locator can still end up being a structural wrapper like:

```text
css=div:nth-of-type(2) > div > div > div > div
```

That is exactly the kind of locator shown in your replay log for the successful click step.

### 2. Replay treats every non-`.value` element as writable text
In `app/renderer.js#runStep()` the `fill` branch does this:

```js
el.focus();
if ('value' in el) {
  el.value = v;
} else {
  el.textContent = v;
}
el.dispatchEvent(new Event('input', { bubbles: true }));
el.dispatchEvent(new Event('change', { bubbles: true }));
```

That fallback is too broad.

It assumes:

- if the element is not an `<input>`/`<textarea>`,
- then writing `textContent` is the correct fill behavior.

That is only valid for true editable surfaces such as `contenteditable`.

For ordinary wrapper `<div>` elements, it just paints text into the page.

## Reproduction
This behavior is easy to reproduce with the current replay logic:

1. A fill step resolves to a wrapper locator such as:

```json
{ "strategy": "css", "value": "div#box" }
```

2. Replay finds that wrapper.

3. Because the wrapper has no `.value` property, replay runs the fallback:

```js
el.textContent = "cat";
```

4. The DOM becomes:

```html
<div id="box">cat</div>
```

This is the same failure mode you described: the text is shown on top of the page, not entered into the actual field.

## Why this explains your issue
Your log shows the initial click replaying against a deep wrapper CSS path:

```text
Step 1/8: click — css=div:nth-of-type(2) > div > div > div > div
```

That means replay is already operating on a generic container, not a stable field locator like:

- `id=...`
- `name=...`
- `ariaLabel=...`
- `placeholder=...`

If the subsequent fill reuses that same kind of target, replay either:

- fails to find the right control, or
- writes `textContent` into the wrapper

Both outcomes are consistent with what you saw.

## Correct fix direction
This bug should be fixed in two places:

### 1. Record the real editable control, not the wrapper
When the user clicks to type, the recorder should resolve and store the actual editable element whenever possible:

- prefer `id`
- then `name`
- then `aria-label`
- then `placeholder`
- then a CSS path anchored to the actual input/textarea/contenteditable root

This matches your requirement: “record id of tag when replay must work”.

### 2. Never use `textContent` as a generic fill fallback
Replay should only write:

- `.value = ...` for `INPUT` / `TEXTAREA`
- `.textContent` / richer editing APIs for true `contenteditable`

If the matched element is neither of those, replay should:

- search for a descendant editable control inside it, or
- fail with a targeted error like `fill target is not editable`

It should **not** mutate arbitrary containers.

## Recommended implementation
- In recording/preload:
  - add logic that, for fill-related interactions, prefers the actual editable descendant/root instead of a decorative wrapper
  - preserve stable attributes from that real control
- In replay:
  - replace the current `else { el.textContent = v; }` fallback
  - explicitly branch on:
    - `HTMLInputElement`
    - `HTMLTextAreaElement`
    - `HTMLElement.isContentEditable === true`
  - otherwise, look for `el.querySelector('input, textarea, [contenteditable=\"\"], [contenteditable=\"true\"], [contenteditable=\"plaintext-only\"]')`
  - if nothing editable is found, throw an error instead of drawing text into the page

## Test coverage to add
- replaying a fill on a wrapper that contains an `<input>`
- replaying a fill on a true `contenteditable` editor root
- asserting that replay never mutates `textContent` on a plain non-editable `<div>`

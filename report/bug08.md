# bug08: generated Puppeteer `fill` steps still use stale value assignment and plain `Event('input')`, so frameworks can ignore the typed value

## Severity
High

## Affected code
- `src/codegen.ts:58-62`
- `tests/codegen.test.ts:114-118`

## Summary
The generated Puppeteer code for text-locator `fill` steps still uses the old implementation:

```js
if ('value' in n) n.value = v;
else n.textContent = v;
n.dispatchEvent(new Event('input', { bubbles: true }));
n.dispatchEvent(new Event('change', { bubbles: true }));
```

That is weaker than the current in-app replay implementation, which already uses:

- the native `HTMLInputElement` / `HTMLTextAreaElement` prototype setter
- `InputEvent`
- `composed: true`

As a result, exported/generated Puppeteer scripts can show text in the field but still fail to commit that value into framework state, so the next click/submit behaves as if nothing was typed.

## Root cause
The app replay path was fixed in `app/renderer.js` to handle controlled inputs correctly:

```js
var _desc = _proto && Object.getOwnPropertyDescriptor(_proto, 'value');
if (_desc && _desc.set) _desc.set.call(el, v);
...
new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: v })
```

But the generated Puppeteer code in `src/codegen.ts` was not updated and still emits:

```js
n.value = v
dispatchEvent(new Event('input', { bubbles: true }))
```

So there is now a split-brain implementation:

- app replay path: framework-aware
- generated Puppeteer path: stale and less compatible

## Reproduction
I verified the behavioral difference locally with a minimal DOM that simulates framework-style value tracking:

Observed result:

```json
{
  "directAccepted": false,
  "nativeSetterAccepted": true,
  "finalValue": "dog"
}
```

Meaning:

- direct assignment + `Event('input')` was **not** accepted by the simulated tracker
- native prototype setter + input dispatch **was** accepted

This matches real-world controlled inputs in frameworks such as React, where direct `.value = ...` can visibly change the field but not update internal state used by later submit handlers.

## Why this matters
This is the same class of failure users describe as:

- “text shows on the input”
- “but submit / next steps act like the value was not entered”

The generated Puppeteer file can therefore look correct on screen while still producing broken end-to-end behavior.

## Why tests did not catch it
`tests/codegen.test.ts` currently locks in the stale behavior as expected:

```ts
expect(out).toContain("n.value = v");
expect(out).toContain("dispatchEvent(new Event('input'");
```

So the test suite preserves the bug instead of detecting it.

## Recommended fix
- Update the Puppeteer fill-by-text generator in `src/codegen.ts` to mirror the fixed replay logic from `app/renderer.js`.
- Use the native prototype setter for `INPUT` / `TEXTAREA`.
- Emit `InputEvent` when available, not plain `Event('input')`.
- Include `composed: true` so the event crosses shadow boundaries consistently.
- Replace the current codegen expectations in `tests/codegen.test.ts` with assertions for the framework-aware implementation.

## Suggested implementation shape
Generated Puppeteer code should look closer to:

```js
await _el.evaluate((n, v) => {
  if ('value' in n) {
    const proto = n.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const desc = proto && Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(n, v);
    else n.value = v;
  } else {
    n.textContent = v;
  }
  const ie = typeof InputEvent === 'function'
    ? new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: v })
    : new Event('input', { bubbles: true });
  n.dispatchEvent(ie);
  n.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
}, value);
```

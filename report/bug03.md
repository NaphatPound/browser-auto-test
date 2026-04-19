# bug03: inputs inside shadow DOM record only the host click, not the typed text

## Severity
Medium

## Affected code
- `src/inject.ts:90-110`
- `app/webview-preload.cjs:74-99`
- `tests/inject.test.ts:44-80`

## Summary
The recorder reads `ev.target` directly from document-level listeners. For controls inside a shadow root, composed events are retargeted to the shadow host by the time they reach `document`.

That means:

- the click is recorded against the host element
- the `input` event is also seen as targeting the host
- `isEditable(host)` returns `false`
- no `fill` step is recorded

This matches the user-visible symptom: typing appears to record only a click.

## Root cause
Both the core injector and the Electron preload use the same pattern:

- `const t = ev.target as Element | null`
- `onInput()` drops the event unless `isEditable(t)` is true

For shadow-DOM inputs, `t` is often the host element, not the inner `<input>` / `<textarea>`. The host is not editable, so the recorder throws away the typed value.

## Reproduction
Verified locally with the current code by attaching the recorder to a document containing:

```html
<div id="host"></div>
```

where `#host` has an open shadow root containing:

```html
<input name="username">
```

After dispatching:

1. a composed `click` on the inner input
2. a composed `input` event after setting `input.value = "alice"`

the recorder produced:

```json
[
  {
    "type": "click",
    "locator": { "strategy": "id", "value": "host" }
  }
]
```

Expected behavior:

```json
[
  {
    "type": "click",
    "locator": { "strategy": "name", "value": "username" }
  },
  {
    "type": "fill",
    "locator": { "strategy": "name", "value": "username" },
    "text": "alice"
  }
]
```

## Why tests did not catch it
`tests/inject.test.ts` covers:

- native `<input>`
- `<textarea>`
- `contenteditable`
- non-editable elements

There is no test for:

- inputs inside shadow DOM
- composed events retargeted to a host element

## User impact
- Recording fails on web-component based UIs and many design systems that encapsulate form controls in shadow DOM.
- The recorded flow is incomplete: focus/click is kept, typed text is lost.
- Generated test code replays the wrong target because the recorded locator points at the host, not the actual input.

## Recommended fix
- Resolve the original event source from `ev.composedPath()` and prefer the first `Element` in the path over `ev.target`.
- Use that resolved element consistently for `click`, `input`, `change`, and `keydown`.
- Add injector tests for shadow-root-hosted `<input>` and `<textarea>` controls.

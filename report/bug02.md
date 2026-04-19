# bug02: typing is dropped for `contenteditable` and editor-style fields, so only the click is recorded

## Severity
Medium

## Affected code
- `src/inject.ts:57-64`
- `src/inject.ts:95-99`
- `app/webview-preload.cjs:44-50`
- `app/webview-preload.cjs:83-89`
- `tests/inject.test.ts:42-62`

## Summary
The recorder only treats native `<input>` and `<textarea>` elements as editable. When the page uses a `contenteditable` element or a custom rich-text/editor wrapper, the initial focus click is recorded, but the subsequent typing is ignored.

That matches the symptom "input only records click".

## Root cause
Both the core injector and the Electron preload gate `input` handling behind `isEditable()`:

- `src/inject.ts` returns `true` only for `INPUT` and `TEXTAREA`
- `app/webview-preload.cjs` duplicates the same restriction
- `onInput` exits early when `isEditable(t)` is false

So this event flow happens on editor-like fields:

1. User clicks the editable element
2. `click` handler records a `click` step
3. User types
4. `input` event fires, but `isEditable()` rejects the target
5. No `fill` step is recorded

## Reproduction
Verified locally against the built code with a `contenteditable` element:

```html
<div id="ed" contenteditable="true">hello</div>
```

Observed recorded steps after `click` + `input`:

```json
[
  {
    "type": "click",
    "locator": { "strategy": "id", "value": "ed" }
  }
]
```

Expected behavior:

```json
[
  {
    "type": "click",
    "locator": { "strategy": "id", "value": "ed" }
  },
  {
    "type": "fill",
    "locator": { "strategy": "id", "value": "ed" },
    "text": "hello world"
  }
]
```

## Why tests did not catch it
`tests/inject.test.ts` only covers:

- native `<input>`
- `<textarea>`
- checkbox
- `<select>`

There is no coverage for:

- `contenteditable`
- rich-text editors
- custom controls that emit `input` but are not `INPUT` or `TEXTAREA`

## User impact
- Recording works on simple native form fields, but fails on many modern apps that use editor-style controls.
- The generated script misses typed text and replays only the click/focus step.
- This makes recorded flows incomplete and misleading for login forms, chat boxes, CMS editors, and rich UI frameworks that do not expose a plain native input as the event target.

## Recommended fix
- Expand `isEditable()` to accept `HTMLElement.isContentEditable`.
- When the target is content-editable, capture text from `textContent` or `innerText` instead of `.value`.
- Add tests for `contenteditable` in `tests/inject.test.ts`.
- Remove the duplicated logic between `src/inject.ts` and `app/webview-preload.cjs`, or keep them strictly in sync with shared behavior.

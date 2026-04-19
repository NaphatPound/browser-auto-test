# bug04: Mermaid flowchart generation leaves raw double quotes in node labels, causing parse errors

## Severity
Medium

## Affected code
- `app/renderer.js:145-179`
- `src/flowchart.ts:54-75`
- `tests/flowchart.test.ts:59-75`

## Summary
The Mermaid flowchart generator sanitizes brackets and braces, but it does not sanitize or escape double quotes inside node labels.

When a recorded step includes text such as `"c"` or a locator/value containing `"..."`, the generated Mermaid source contains raw quotes inside a node body, which Mermaid rejects with a parse error.

This matches the runtime failure:

```text
Diagram error: Parse error on line 5: ... step_1[Fill: c "c"] ...
```

## Root cause
Both Mermaid label builders format user data directly into the node text:

- `app/renderer.js#stepLabel()` adds ` "${step.text}"` or ` "${step.selectValue}"`
- `src/flowchart.ts#getStepLabel()` adds ` ("${step.text}")` or ` ("${step.selectValue}")`

The sanitization step only removes:

- `[ ]`
- `( )`
- `{ }`

It does **not** remove or escape:

- `"`

So a `fill` step with:

```ts
{ type: 'fill', locator: { strategy: 'text', value: 'c' }, text: 'c' }
```

produces Mermaid like:

```text
step_0[Fill: c  "c" ]
```

That is enough to break Mermaid parsing in the app.

## Reproduction
Using the current flowchart generator with a suite containing one `fill` step whose locator/value or text includes quotes produces Mermaid source with raw `"` characters in the node label.

Observed generated output from the current code:

```text
graph TD
  Start([Start: URL])
  step_0[Fill: c  "c" ]
  Start --> step_0
  End([End])
  step_0 --> End
```

Expected behavior:

- Mermaid source should render successfully for ordinary typed text.
- User-provided strings should be escaped or normalized before being inserted into node labels.

## Why tests did not catch it
`tests/flowchart.test.ts` checks that brackets are stripped, but it does not verify:

- double quotes in labels
- a real Mermaid parse/render pass
- the separate renderer-side generator in `app/renderer.js`

So the suite passes even though the app’s Flowchart tab can fail at runtime.

## User impact
- The Flowchart/Mermaid tab can fail to render for normal recorded typing steps.
- Exported Mermaid/HTML flowcharts are also at risk because `src/flowchart.ts` shares the same quoting bug.
- The UI degrades to a parser error string instead of showing a diagram.

## Recommended fix
- Centralize Mermaid label generation in one shared implementation instead of keeping separate logic in `app/renderer.js` and `src/flowchart.ts`.
- Sanitize or escape double quotes and other Mermaid-sensitive characters before inserting user data into labels.
- Add tests that cover quoted text and quoted locator values.
- Add at least one test that validates the generated Mermaid source against a real Mermaid parser/render step.

# bug05: Puppeteer text locators generate an invalid selector (`:contains(...)`)

## Severity
High

## Affected code
- `src/locator.ts:58-74`
- `src/codegen.ts:34-63`
- `tests/locator.test.ts:72-75`

## Summary
The shared non-Playwright selector helper returns `:contains("...")` for `text` locators:

```ts
toCssSelector({ strategy: 'text', value: 'Submit' }) === ':contains("Submit")'
```

That is not a valid CSS selector for standard DOM APIs, so Puppeteer-generated tests break when a recorded step uses a text-based locator.

## Root cause
`src/locator.ts` labels `toCssSelector()` as a CSS-only selector renderer, but for `text` it returns:

```ts
return `:contains("${cssEscape(loc.value)}")`;
```

The comment above it already hints at the mismatch:

```ts
// CSS has no text selector — Cypress handles this with .contains()
```

Despite that, `src/codegen.ts` feeds this result directly into Puppeteer APIs that ultimately rely on standard selector parsing:

- `page.click(sel)`
- `page.type(sel, text)`
- `page.focus(sel)`
- `page.waitForSelector(sel, ...)`
- `page.$eval(sel, ...)`

## Reproduction
Verified locally with the current build:

1. `toCssSelector({ strategy: 'text', value: 'Hello' })` returns:

```text
:contains("Hello")
```

2. Passing that selector to a standard DOM query throws immediately:

```text
SyntaxError: ':contains(,,Hello,' is not a valid selector
```

3. Generating a Puppeteer suite with a text locator produces code like:

```js
await page.click(':contains("Submit")');
```

That selector is invalid for Puppeteer/querySelector-based selection, so the generated script cannot execute successfully for text-locator steps.

## Why tests did not catch it
- `tests/codegen.test.ts` does not cover Puppeteer generation for text locators.
- `tests/locator.test.ts` currently asserts the invalid behavior as correct:

```ts
expect(toCssSelector({ strategy: 'text', value: 'Hello' })).toBe(':contains("Hello")');
```

So the test suite passes while preserving a broken selector contract.

## User impact
- Any recorded step that resolves to `locator.strategy === 'text'` can generate unusable Puppeteer code.
- This affects common actions such as clicking a button by visible text or asserting text on an element.
- The failure happens before business logic is exercised, so generated tests appear broken even for simple pages.

## Recommended fix
- Stop treating text locators as CSS selectors in `toCssSelector()`.
- Split framework-specific handling:
  - Puppeteer should use an XPath/text-search strategy or a custom `page.evaluate()` search.
  - Cypress should emit `cy.contains(...)` rather than `cy.get(':contains(...)')`.
- Add codegen tests for text locators in Puppeteer and Cypress.
- Replace the existing locator test that locks in `:contains(...)` as expected output.

import type { Locator } from './types.js';

export interface LocatorCandidate {
  attrs?: Record<string, string | undefined>;
  tag?: string;
  text?: string;
  cssSelector?: string;
}

const cssEscape = (s: string): string => s.replace(/(["\\])/g, '\\$1');

/**
 * Smart locator: pick the most resilient way to identify an element.
 * Priority: data-testid > id > name > aria-label > text > css.
 */
export function pickLocator(el: LocatorCandidate): Locator {
  const a = el.attrs ?? {};

  if (a['data-testid']) {
    return { strategy: 'testId', value: a['data-testid'] };
  }
  if (a.id) {
    return { strategy: 'id', value: a.id };
  }
  if (a.name) {
    return { strategy: 'name', value: a.name };
  }
  if (a['aria-label']) {
    return { strategy: 'ariaLabel', value: a['aria-label'] };
  }
  if (el.text && el.text.trim().length > 0 && el.text.trim().length < 80) {
    return { strategy: 'text', value: el.text.trim() };
  }
  if (el.cssSelector) {
    return { strategy: 'css', value: el.cssSelector };
  }
  return { strategy: 'css', value: el.tag ?? '*' };
}

/** Render a locator into a Playwright-style selector string. */
export function toPlaywrightSelector(loc: Locator): string {
  switch (loc.strategy) {
    case 'testId':
      return `[data-testid="${cssEscape(loc.value)}"]`;
    case 'id':
      return `#${loc.value}`;
    case 'name':
      return `[name="${cssEscape(loc.value)}"]`;
    case 'ariaLabel':
      return `[aria-label="${cssEscape(loc.value)}"]`;
    case 'text':
      return `text=${loc.value}`;
    case 'css':
      return loc.value;
  }
}

/**
 * Render a locator into a CSS-only selector (for Puppeteer/Cypress).
 * Returns `null` for text locators — standard CSS has no text selector, so
 * callers must emit framework-specific text handling (e.g., cy.contains,
 * Puppeteer XPath) instead of feeding a bogus selector to querySelector.
 */
export function toCssSelector(loc: Locator): string | null {
  switch (loc.strategy) {
    case 'testId':
      return `[data-testid="${cssEscape(loc.value)}"]`;
    case 'id':
      return `#${loc.value}`;
    case 'name':
      return `[name="${cssEscape(loc.value)}"]`;
    case 'ariaLabel':
      return `[aria-label="${cssEscape(loc.value)}"]`;
    case 'text':
      return null;
    case 'css':
      return loc.value;
  }
}

/**
 * Render an XPath string literal for a value. Uses the delimiter that is not
 * present in the value; falls back to `concat(...)` when both kinds appear.
 */
export function xpathLiteral(s: string): string {
  if (!s.includes("'")) return `'${s}'`;
  if (!s.includes('"')) return `"${s}"`;
  const parts = s.split("'").map((p) => `'${p}'`);
  return `concat(${parts.join(', "\'", ')})`;
}

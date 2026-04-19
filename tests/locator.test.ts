import { describe, expect, it } from 'vitest';
import { pickLocator, toCssSelector, toPlaywrightSelector, xpathLiteral } from '../src/locator.js';

describe('Smart Locator priority', () => {
  it('prefers data-testid over everything else', () => {
    const loc = pickLocator({
      attrs: { 'data-testid': 'submit-btn', id: 'btn1', name: 'submit', 'aria-label': 'Submit' },
      text: 'Submit',
      tag: 'button',
    });
    expect(loc.strategy).toBe('testId');
    expect(loc.value).toBe('submit-btn');
  });

  it('falls back to id when no testid', () => {
    const loc = pickLocator({ attrs: { id: 'login', name: 'foo' } });
    expect(loc.strategy).toBe('id');
    expect(loc.value).toBe('login');
  });

  it('falls back to name', () => {
    const loc = pickLocator({ attrs: { name: 'username' } });
    expect(loc.strategy).toBe('name');
  });

  it('falls back to aria-label', () => {
    const loc = pickLocator({ attrs: { 'aria-label': 'Close dialog' } });
    expect(loc.strategy).toBe('ariaLabel');
    expect(loc.value).toBe('Close dialog');
  });

  it('uses text when short and present', () => {
    const loc = pickLocator({ text: 'Click me', tag: 'button' });
    expect(loc.strategy).toBe('text');
    expect(loc.value).toBe('Click me');
  });

  it('skips text when too long, falls back to css', () => {
    const long = 'x'.repeat(200);
    const loc = pickLocator({ text: long, cssSelector: 'div.foo > button' });
    expect(loc.strategy).toBe('css');
    expect(loc.value).toBe('div.foo > button');
  });

  it('uses css selector last', () => {
    const loc = pickLocator({ cssSelector: 'button.primary' });
    expect(loc.strategy).toBe('css');
  });

  it('falls back to tag when nothing else available', () => {
    const loc = pickLocator({ tag: 'button' });
    expect(loc.strategy).toBe('css');
    expect(loc.value).toBe('button');
  });
});

describe('Locator rendering', () => {
  it('Playwright selectors', () => {
    expect(toPlaywrightSelector({ strategy: 'testId', value: 'foo' })).toBe('[data-testid="foo"]');
    expect(toPlaywrightSelector({ strategy: 'id', value: 'foo' })).toBe('#foo');
    expect(toPlaywrightSelector({ strategy: 'name', value: 'foo' })).toBe('[name="foo"]');
    expect(toPlaywrightSelector({ strategy: 'ariaLabel', value: 'Close' })).toBe('[aria-label="Close"]');
    expect(toPlaywrightSelector({ strategy: 'text', value: 'Submit' })).toBe('text=Submit');
    expect(toPlaywrightSelector({ strategy: 'css', value: 'button.x' })).toBe('button.x');
  });

  it('escapes double quotes in attribute values', () => {
    const sel = toPlaywrightSelector({ strategy: 'testId', value: 'has"quote' });
    expect(sel).toBe('[data-testid="has\\"quote"]');
  });

  it('CSS selectors for non-Playwright frameworks', () => {
    expect(toCssSelector({ strategy: 'id', value: 'main' })).toBe('#main');
    expect(toCssSelector({ strategy: 'testId', value: 'foo' })).toBe('[data-testid="foo"]');
    expect(toCssSelector({ strategy: 'name', value: 'q' })).toBe('[name="q"]');
    expect(toCssSelector({ strategy: 'css', value: 'div.x' })).toBe('div.x');
  });

  it('returns null for text locators (no valid CSS equivalent)', () => {
    expect(toCssSelector({ strategy: 'text', value: 'Submit' })).toBeNull();
  });
});

describe('xpathLiteral', () => {
  it('wraps values without quotes in single quotes', () => {
    expect(xpathLiteral('Submit')).toBe("'Submit'");
  });

  it('uses double quotes when the value has a single quote', () => {
    expect(xpathLiteral("it's fine")).toBe(`"it's fine"`);
  });

  it('uses single quotes when the value has a double quote', () => {
    expect(xpathLiteral('say "hi"')).toBe(`'say "hi"'`);
  });

  it('uses concat() when the value contains both quote kinds', () => {
    const out = xpathLiteral(`it's "hot"`);
    expect(out.startsWith('concat(')).toBe(true);
    expect(out).toContain(`'it'`);
    expect(out).toContain(`'s "hot"'`);
  });
});

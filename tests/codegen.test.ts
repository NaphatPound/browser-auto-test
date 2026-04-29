import { describe, expect, it } from 'vitest';
import { generate } from '../src/codegen.js';
import type { TestSuite } from '../src/types.js';

const sample: TestSuite = {
  name: 'login flow',
  baseUrl: 'https://example.com',
  createdAt: '2026-04-17T00:00:00.000Z',
  steps: [
    { id: '1', type: 'navigate', url: 'https://example.com/login' },
    { id: '2', type: 'fill', locator: { strategy: 'name', value: 'username' }, text: 'alice' },
    { id: '3', type: 'fill', locator: { strategy: 'name', value: 'password' }, text: 'p@ss' },
    { id: '4', type: 'click', locator: { strategy: 'testId', value: 'submit' } },
    { id: '5', type: 'assertVisible', locator: { strategy: 'text', value: 'Welcome' } },
  ],
};

describe('Code generation', () => {
  it('generates valid Playwright test', () => {
    const out = generate(sample, 'playwright');
    expect(out).toContain("import { test, expect } from '@playwright/test'");
    expect(out).toContain("test('login flow'");
    expect(out).toContain("page.goto('https://example.com/login')");
    expect(out).toContain("page.fill('[name=\"username\"]', 'alice')");
    expect(out).toContain("page.click('[data-testid=\"submit\"]')");
    expect(out).toContain("toBeVisible()");
  });

  it('generates Puppeteer script', () => {
    const out = generate(sample, 'puppeteer');
    expect(out).toContain("import puppeteer from 'puppeteer'");
    expect(out).toContain("puppeteer.launch()");
    expect(out).toContain("page.type('[name=\"username\"]', 'alice')");
    expect(out).toContain("browser.close()");
  });

  it('generates Cypress test', () => {
    const out = generate(sample, 'cypress');
    expect(out).toContain("describe('login flow'");
    expect(out).toContain("cy.visit('https://example.com/login')");
    expect(out).toContain("cy.get('[name=\"username\"]').type('alice')");
    expect(out).toContain("cy.get('[data-testid=\"submit\"]').click()");
  });

  it('handles wait, hover, select, press, check', () => {
    const suite: TestSuite = {
      name: 'misc',
      createdAt: '2026-04-17T00:00:00.000Z',
      steps: [
        { id: 'a', type: 'wait', timeoutMs: 500 },
        { id: 'b', type: 'hover', locator: { strategy: 'id', value: 'menu' } },
        { id: 'c', type: 'select', locator: { strategy: 'id', value: 'country' }, selectValue: 'TH' },
        { id: 'd', type: 'press', locator: { strategy: 'id', value: 'q' }, key: 'Enter' },
        { id: 'e', type: 'check', locator: { strategy: 'id', value: 'agree' } },
      ],
    };
    const pw = generate(suite, 'playwright');
    expect(pw).toContain('waitForTimeout(500)');
    expect(pw).toContain("page.hover('#menu')");
    expect(pw).toContain("page.selectOption('#country', 'TH')");
    expect(pw).toContain("page.press('#q', 'Enter')");
    expect(pw).toContain("page.check('#agree')");
  });

  it('escapes single quotes in user-typed text', () => {
    const suite: TestSuite = {
      name: 'quoting',
      createdAt: '2026-04-17T00:00:00.000Z',
      steps: [
        { id: '1', type: 'fill', locator: { strategy: 'id', value: 'msg' }, text: "it's fine" },
      ],
    };
    const out = generate(suite, 'playwright');
    expect(out).toContain("'it\\'s fine'");
  });

  it('sanitizes test name with special chars', () => {
    const suite: TestSuite = { ...sample, name: 'login <flow>!!!' };
    const out = generate(suite, 'playwright');
    expect(out).toContain("test('login flow'");
  });

  it('renders comment steps as source comments instead of executable actions', () => {
    const suite: TestSuite = {
      name: 'annotated',
      createdAt: '2026-04-17T00:00:00.000Z',
      steps: [
        { id: '1', type: 'navigate', url: 'https://example.com' },
        {
          id: '2',
          type: 'comment',
          locator: { strategy: 'id', value: 'submit' },
          note: 'Expected a validation banner here',
        },
      ],
    };
    const out = generate(suite, 'playwright');
    expect(out).toContain('// Comment on id=submit: Expected a validation banner here');
    expect(out).not.toContain('page.comment');
  });

  describe('text locators', () => {
    const textSuite: TestSuite = {
      name: 'text flow',
      createdAt: '2026-04-20T00:00:00.000Z',
      steps: [
        { id: 't1', type: 'click', locator: { strategy: 'text', value: 'Submit' } },
        { id: 't2', type: 'fill', locator: { strategy: 'text', value: 'Name' }, text: 'alice' },
        {
          id: 't3',
          type: 'assertVisible',
          locator: { strategy: 'text', value: 'Welcome' },
        },
      ],
    };

    it('Puppeteer uses XPath (page.$x) — never emits :contains(...)', () => {
      const out = generate(textSuite, 'puppeteer');
      expect(out).not.toContain(':contains(');
      expect(out).toContain('page.$x');
      // q() wraps in JS single quotes and escapes inner ones, so the XPath
      // literal in the source is `\'Submit\'` — assert via regex instead.
      expect(out).toMatch(/normalize-space\(text\(\)\)=\\'Submit\\'/);
    });

    it('Puppeteer click-by-text produces a runnable handle block', () => {
      const out = generate(textSuite, 'puppeteer');
      expect(out).toContain('const [_el] = await page.$x(');
      expect(out).toContain('await _el.click();');
      expect(out).toContain("text locator not found: Submit");
    });

    it('Puppeteer fill-by-text focuses the handle and dispatches input events', () => {
      const out = generate(textSuite, 'puppeteer');
      expect(out).toContain('await _el.focus();');
      expect(out).toContain("n.value = v");
      expect(out).toContain("dispatchEvent(new Event('input'");
    });

    it('Cypress uses cy.contains() for text locators — never cy.get(\':contains(...)\')', () => {
      const out = generate(textSuite, 'cypress');
      expect(out).not.toContain(':contains(');
      expect(out).toContain("cy.contains('Submit').click()");
      expect(out).toContain("cy.contains('Name').type('alice')");
      expect(out).toContain("cy.contains('Welcome').should('be.visible')");
    });

    it('Playwright keeps the text= selector', () => {
      const out = generate(textSuite, 'playwright');
      expect(out).toContain("page.click('text=Submit')");
    });

    it("Puppeteer XPath uses concat() when the value contains both ' and \"", () => {
      const tricky: TestSuite = {
        name: 'tricky',
        createdAt: '2026-04-20T00:00:00.000Z',
        steps: [
          { id: 'x', type: 'click', locator: { strategy: 'text', value: `it's "hot"` } },
        ],
      };
      const out = generate(tricky, 'puppeteer');
      expect(out).not.toContain(':contains(');
      expect(out).toContain('concat(');
    });
  });
});

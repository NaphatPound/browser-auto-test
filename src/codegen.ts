import type { Framework, Step, TestSuite } from './types.js';
import { toCssSelector, toPlaywrightSelector, xpathLiteral } from './locator.js';

const q = (s: string): string => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

const isTextLoc = (step: Step): boolean => step.locator?.strategy === 'text';
const noteLine = (step: Step): string => {
  const target = step.locator ? ` on ${step.locator.strategy}=${step.locator.value}` : '';
  return `  // Comment${target}: ${(step.note ?? '').replace(/\r?\n/g, ' ').trim()}`;
};

function playwrightStep(step: Step): string {
  const sel = step.locator ? toPlaywrightSelector(step.locator) : '';
  switch (step.type) {
    case 'navigate':
      return `  await page.goto(${q(step.url ?? '')});`;
    case 'click':
      return `  await page.click(${q(sel)});`;
    case 'fill':
      return `  await page.fill(${q(sel)}, ${q(step.text ?? '')});`;
    case 'press':
      return `  await page.press(${q(sel)}, ${q(step.key ?? 'Enter')});`;
    case 'hover':
      return `  await page.hover(${q(sel)});`;
    case 'check':
      return `  await page.check(${q(sel)});`;
    case 'uncheck':
      return `  await page.uncheck(${q(sel)});`;
    case 'select':
      return `  await page.selectOption(${q(sel)}, ${q(step.selectValue ?? '')});`;
    case 'wait':
      return `  await page.waitForTimeout(${step.timeoutMs ?? 1000});`;
    case 'comment':
      return noteLine(step);
    case 'assertText':
      return `  await expect(page.locator(${q(sel)})).toHaveText(${q(step.text ?? '')});`;
    case 'assertVisible':
      return `  await expect(page.locator(${q(sel)})).toBeVisible();`;
  }
}

/**
 * Emit a Puppeteer block that finds an element by text (via XPath) and runs
 * `actions` on it. Throws at runtime if the element cannot be found.
 */
function puppeteerTextBlock(step: Step, actions: string): string {
  const xp = `//*[normalize-space(text())=${xpathLiteral(step.locator?.value ?? '')}]`;
  return `  {
    const [_el] = await page.$x(${q(xp)});
    if (!_el) throw new Error(${q('text locator not found: ' + (step.locator?.value ?? ''))});
${actions}
  }`;
}

function puppeteerStep(step: Step): string {
  if (isTextLoc(step)) {
    switch (step.type) {
      case 'click':
      case 'check':
      case 'uncheck':
        return puppeteerTextBlock(step, `    await _el.click();`);
      case 'hover':
        return puppeteerTextBlock(step, `    await _el.hover();`);
      case 'fill':
        return puppeteerTextBlock(
          step,
          `    await _el.focus();\n    await _el.evaluate((n, v) => { if ('value' in n) n.value = v; else n.textContent = v; n.dispatchEvent(new Event('input', { bubbles: true })); n.dispatchEvent(new Event('change', { bubbles: true })); }, ${q(step.text ?? '')});`,
        );
      case 'press':
        return puppeteerTextBlock(
          step,
          `    await _el.focus();\n    await page.keyboard.press(${q(step.key ?? 'Enter')});`,
        );
      case 'select':
        return puppeteerTextBlock(
          step,
          `    await _el.evaluate((n, v) => { n.value = v; n.dispatchEvent(new Event('change', { bubbles: true })); }, ${q(step.selectValue ?? '')});`,
        );
      case 'comment':
        return noteLine(step);
      case 'assertText':
        return puppeteerTextBlock(
          step,
          `    const _t = await _el.evaluate((n) => (n.textContent || '').trim());\n    if (_t !== ${q(step.text ?? '')}) throw new Error('assertText failed');`,
        );
      case 'assertVisible':
        return puppeteerTextBlock(step, `    // visible by virtue of matching the XPath`);
      default:
        return `  // unsupported step type with text locator: ${step.type}`;
    }
  }

  const sel = step.locator ? toCssSelector(step.locator) : '';
  switch (step.type) {
    case 'navigate':
      return `  await page.goto(${q(step.url ?? '')});`;
    case 'click':
      return `  await page.click(${q(sel ?? '')});`;
    case 'fill':
      return `  await page.type(${q(sel ?? '')}, ${q(step.text ?? '')});`;
    case 'press':
      return `  await page.focus(${q(sel ?? '')});\n  await page.keyboard.press(${q(step.key ?? 'Enter')});`;
    case 'hover':
      return `  await page.hover(${q(sel ?? '')});`;
    case 'check':
      return `  await page.click(${q(sel ?? '')});`;
    case 'uncheck':
      return `  await page.click(${q(sel ?? '')});`;
    case 'select':
      return `  await page.select(${q(sel ?? '')}, ${q(step.selectValue ?? '')});`;
    case 'wait':
      return `  await new Promise(r => setTimeout(r, ${step.timeoutMs ?? 1000}));`;
    case 'comment':
      return noteLine(step);
    case 'assertText': {
      return `  {
    const _t = await page.$eval(${q(sel ?? '')}, el => el.textContent);
    if (_t?.trim() !== ${q(step.text ?? '')}) throw new Error('assertText failed');
  }`;
    }
    case 'assertVisible':
      return `  await page.waitForSelector(${q(sel ?? '')}, { visible: true });`;
  }
}

function cypressStep(step: Step): string {
  // Text locators use cy.contains() which queries across text nodes. Feeding
  // a text value to cy.get() with ':contains(...)' would produce an invalid
  // selector (bug05).
  const head = isTextLoc(step)
    ? `cy.contains(${q(step.locator?.value ?? '')})`
    : `cy.get(${q(step.locator ? toCssSelector(step.locator) ?? '' : '')})`;
  switch (step.type) {
    case 'navigate':
      return `  cy.visit(${q(step.url ?? '')});`;
    case 'click':
      return `  ${head}.click();`;
    case 'fill':
      return `  ${head}.type(${q(step.text ?? '')});`;
    case 'press':
      return `  ${head}.type(${q('{' + (step.key ?? 'enter').toLowerCase() + '}')});`;
    case 'hover':
      return `  ${head}.trigger('mouseover');`;
    case 'check':
      return `  ${head}.check();`;
    case 'uncheck':
      return `  ${head}.uncheck();`;
    case 'select':
      return `  ${head}.select(${q(step.selectValue ?? '')});`;
    case 'wait':
      return `  cy.wait(${step.timeoutMs ?? 1000});`;
    case 'comment':
      return noteLine(step);
    case 'assertText':
      return `  ${head}.should('have.text', ${q(step.text ?? '')});`;
    case 'assertVisible':
      return `  ${head}.should('be.visible');`;
  }
}

export function generateStep(step: Step, framework: Framework): string {
  switch (framework) {
    case 'playwright':
      return playwrightStep(step);
    case 'puppeteer':
      return puppeteerStep(step);
    case 'cypress':
      return cypressStep(step);
  }
}

export function generate(suite: TestSuite, framework: Framework): string {
  const safeName = suite.name.replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'recorded test';

  if (framework === 'playwright') {
    const body = suite.steps.map(playwrightStep).join('\n');
    return `import { test, expect } from '@playwright/test';

test(${q(safeName)}, async ({ page }) => {
${body}
});
`;
  }

  if (framework === 'puppeteer') {
    const body = suite.steps.map(puppeteerStep).join('\n');
    return `import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
${body}
  await browser.close();
})();
`;
  }

  // cypress
  const body = suite.steps.map(cypressStep).join('\n');
  return `describe(${q(safeName)}, () => {
  it(${q('runs recorded steps')}, () => {
${body}
  });
});
`;
}

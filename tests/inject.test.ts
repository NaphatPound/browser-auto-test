import { beforeEach, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { Recorder } from '../src/recorder.js';
import { attach, cssPath, extractCandidate } from '../src/inject.js';

describe('inject — DOM event capture', () => {
  let dom: JSDOM;
  let doc: Document;
  let rec: Recorder;
  let detach: () => void;

  beforeEach(() => {
    dom = new JSDOM(`
      <!doctype html><html><body>
        <button id="login-btn" data-testid="login">Sign in</button>
        <input name="username" />
        <input name="agree" type="checkbox" />
        <select name="country">
          <option value="th">Thailand</option>
          <option value="jp">Japan</option>
        </select>
        <textarea name="bio"></textarea>
        <div id="editor" contenteditable="true"></div>
        <div id="readonly-div">read only</div>
        <div id="shadow-host"></div>
        <ul><li>a</li><li>b</li><li>c</li></ul>
      </body></html>
    `);
    doc = dom.window.document;
    rec = new Recorder();
    rec.start('https://app.test');
    detach = attach({ recorder: rec, document: doc });
  });

  it('captures a click with a data-testid locator', () => {
    const btn = doc.querySelector('#login-btn')!;
    (btn as HTMLElement).dispatchEvent(new dom.window.Event('click', { bubbles: true }));

    const steps = rec.getSteps();
    expect(steps).toHaveLength(1);
    expect(steps[0].type).toBe('click');
    expect(steps[0].locator).toEqual({ strategy: 'testId', value: 'login' });
  });

  it('captures input as a fill step with text', () => {
    const input = doc.querySelector('input[name="username"]') as HTMLInputElement;
    input.value = 'alice';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

    const steps = rec.getSteps();
    expect(steps).toHaveLength(1);
    expect(steps[0].type).toBe('fill');
    expect(steps[0].text).toBe('alice');
    expect(steps[0].locator).toEqual({ strategy: 'name', value: 'username' });
  });

  it('captures textarea input as a fill step', () => {
    const ta = doc.querySelector('textarea[name="bio"]') as HTMLTextAreaElement;
    ta.value = 'hello world';
    ta.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

    const steps = rec.getSteps();
    expect(steps[0].type).toBe('fill');
    expect(steps[0].text).toBe('hello world');
  });

  it('captures input on a contenteditable element as a fill step with textContent', () => {
    const ed = doc.querySelector('#editor') as HTMLElement;
    ed.textContent = 'hello world';
    ed.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

    const steps = rec.getSteps();
    expect(steps).toHaveLength(1);
    expect(steps[0].type).toBe('fill');
    expect(steps[0].text).toBe('hello world');
    expect(steps[0].locator).toEqual({ strategy: 'id', value: 'editor' });
  });

  it('ignores input events on non-editable elements', () => {
    const ro = doc.querySelector('#readonly-div') as HTMLElement;
    ro.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    expect(rec.getSteps()).toHaveLength(0);
  });

  it('skips textContent as locator for a contenteditable with no identifying attrs', () => {
    // A rich editor without aria-label / role / testId: typing must not
    // produce a text= locator (the "text" is the user's own typed value and
    // would change on every keystroke).
    const root = doc.createElement('div');
    root.setAttribute('contenteditable', 'true');
    root.id = '';
    const inner = doc.createElement('p');
    inner.textContent = 'cat';
    root.appendChild(inner);
    doc.body.appendChild(root);

    inner.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

    const steps = rec.getSteps();
    expect(steps).toHaveLength(1);
    expect(steps[0].type).toBe('fill');
    expect(steps[0].locator?.strategy).not.toBe('text');
    expect(steps[0].text).toBe('cat');
  });

  it('attaches locators to the editor root when typing inside a nested element', () => {
    // Rich editors often wrap text in <p>/<span>. The inner tag is where the
    // event fires, but the stable attributes live on the outer editable div.
    const root = doc.createElement('div');
    root.setAttribute('contenteditable', 'true');
    root.setAttribute('aria-label', 'Search');
    const inner = doc.createElement('p');
    inner.textContent = 'cat';
    root.appendChild(inner);
    doc.body.appendChild(root);

    // Clicking the inner <p> should record as a click on the editor root.
    inner.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    // Typing dispatches input events whose target is also the inner <p>.
    inner.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

    const steps = rec.getSteps();
    expect(steps).toHaveLength(2);
    expect(steps[0].locator).toEqual({ strategy: 'ariaLabel', value: 'Search' });
    expect(steps[1]).toMatchObject({
      type: 'fill',
      locator: { strategy: 'ariaLabel', value: 'Search' },
      text: 'cat',
    });
  });

  it('resolves the real control inside an open shadow root via composedPath', () => {
    const host = doc.querySelector('#shadow-host') as HTMLElement;
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<input name="username"><button data-testid="go">Go</button>';
    const inner = shadow.querySelector('input[name="username"]') as HTMLInputElement;
    const btn = shadow.querySelector('button[data-testid="go"]') as HTMLElement;

    btn.dispatchEvent(new dom.window.Event('click', { bubbles: true, composed: true }));
    inner.value = 'alice';
    inner.dispatchEvent(new dom.window.Event('input', { bubbles: true, composed: true }));

    const steps = rec.getSteps();
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({
      type: 'click',
      locator: { strategy: 'testId', value: 'go' },
    });
    expect(steps[1]).toMatchObject({
      type: 'fill',
      text: 'alice',
      locator: { strategy: 'name', value: 'username' },
    });
  });

  it('captures checkbox click as check/uncheck based on state', () => {
    const cb = doc.querySelector('input[type="checkbox"]') as HTMLInputElement;
    cb.checked = true;
    cb.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    cb.checked = false;
    cb.dispatchEvent(new dom.window.Event('click', { bubbles: true }));

    const steps = rec.getSteps();
    expect(steps.map((s) => s.type)).toEqual(['check', 'uncheck']);
  });

  it('captures select change as a select step with selectValue', () => {
    const sel = doc.querySelector('select[name="country"]') as HTMLSelectElement;
    sel.value = 'jp';
    sel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

    const steps = rec.getSteps();
    expect(steps).toHaveLength(1);
    expect(steps[0].type).toBe('select');
    expect(steps[0].selectValue).toBe('jp');
  });

  it('captures Enter/Tab keydown as a press step, ignores other keys', () => {
    const input = doc.querySelector('input[name="username"]') as HTMLInputElement;
    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));

    const steps = rec.getSteps();
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ type: 'press', key: 'Enter' });
    expect(steps[1]).toMatchObject({ type: 'press', key: 'Tab' });
  });

  it('stops capturing after detach()', () => {
    detach();
    const btn = doc.querySelector('#login-btn')!;
    (btn as HTMLElement).dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    expect(rec.getSteps()).toHaveLength(0);
  });

  it('does not record when recorder is stopped', () => {
    rec.stop();
    const btn = doc.querySelector('#login-btn')!;
    (btn as HTMLElement).dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    expect(rec.getSteps()).toHaveLength(0);
  });
});

describe('cssPath', () => {
  it('uses #id when available', () => {
    const dom = new JSDOM(`<div id="wrap"><span id="x">y</span></div>`);
    const el = dom.window.document.querySelector('#x')!;
    expect(cssPath(el)).toBe('span#x');
  });

  it('uses nth-of-type among siblings of the same tag', () => {
    const dom = new JSDOM(`<ul><li>a</li><li class="t">b</li><li>c</li></ul>`);
    const el = dom.window.document.querySelectorAll('li')[1];
    expect(cssPath(el)).toContain(':nth-of-type(2)');
  });
});

describe('extractCandidate', () => {
  it('lifts the expected attributes and trims text', () => {
    const dom = new JSDOM(
      `<button id="x" data-testid="t" aria-label="Go">  Click me  </button>`,
    );
    const el = dom.window.document.querySelector('button')!;
    const cand = extractCandidate(el);
    expect(cand.tag).toBe('button');
    expect(cand.text).toBe('Click me');
    expect(cand.attrs?.['data-testid']).toBe('t');
    expect(cand.attrs?.['aria-label']).toBe('Go');
    expect(cand.attrs?.id).toBe('x');
  });
});

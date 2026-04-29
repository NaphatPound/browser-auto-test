import { describe, expect, it } from 'vitest';
import {
  buildBugReport,
  createEmptyDiagnostics,
  describeStep,
  diagnosticsCounts,
} from '../app/report-utils.js';

describe('app/report-utils', () => {
  it('describes comment steps with their target and note', () => {
    const desc = describeStep({
      type: 'comment',
      locator: { strategy: 'css', value: '#login' },
      note: 'Login button stays disabled after valid input',
    });
    expect(desc).toContain('css=#login');
    expect(desc).toContain('Login button stays disabled');
  });

  it('counts diagnostics by category', () => {
    const bag = createEmptyDiagnostics();
    bag.console.push({ level: 'error', message: 'boom' });
    bag.network.push({ source: 'fetch', url: '/api', status: 500 });
    expect(diagnosticsCounts(bag)).toEqual({
      consoleCount: 1,
      networkCount: 1,
      pageCount: 0,
      total: 2,
    });
  });

  it('builds an AI-friendly Markdown report with summary, annotations, and runtime issues', () => {
    const replay = {
      suiteName: 'checkout flow',
      framework: 'playwright',
      baseUrl: 'https://shop.example',
      startedAt: '2026-04-29T07:00:00.000Z',
      totalMs: 840,
      diagnostics: {
        console: [
          {
            level: 'error',
            message: 'Uncaught ReferenceError: cartTotal is not defined',
            sourceId: 'checkout.js',
            line: 22,
            stepIndex: 2,
          },
        ],
        page: [
          {
            message: 'Cannot read properties of undefined (reading "items")',
            source: 'window.error',
            stepIndex: 2,
          },
        ],
        network: [
          {
            source: 'fetch',
            url: 'https://shop.example/api/checkout',
            method: 'POST',
            status: 500,
            statusText: 'Internal Server Error',
            stepIndex: 3,
          },
        ],
      },
      results: [
        { index: 0, stepId: '1', type: 'navigate', status: 'passed', durationMs: 120 },
        { index: 1, stepId: '2', type: 'fill', status: 'passed', durationMs: 80 },
        { index: 2, stepId: '3', type: 'comment', status: 'passed', durationMs: 1 },
        { index: 3, stepId: '4', type: 'click', status: 'failed', durationMs: 210, error: 'element not found' },
      ],
    };
    const steps = [
      { id: '1', type: 'navigate', url: 'https://shop.example/checkout' },
      { id: '2', type: 'fill', locator: { strategy: 'name', value: 'email' }, text: 'alice@example.com' },
      {
        id: '3',
        type: 'comment',
        locator: { strategy: 'css', value: '[data-testid="submit-order"]' },
        note: 'CTA looks enabled but click fails after form validation',
      },
      { id: '4', type: 'click', locator: { strategy: 'css', value: '[data-testid="submit-order"]' } },
    ];

    const md = buildBugReport(replay, steps, {
      summary: 'Checkout fails after valid details. Repro is stable in the Electron recorder.',
      generateStepCode: () => "await page.click('[data-testid=\"submit-order\"]');",
    });

    expect(md).toContain('# Bug Report: checkout flow');
    expect(md).toContain('## Recorder Summary');
    expect(md).toContain('## Annotated Elements');
    expect(md).toContain('## Replay Failures');
    expect(md).toContain('## Console Issues');
    expect(md).toContain('## Runtime Exceptions');
    expect(md).toContain('## Network Issues');
    expect(md).toContain('CTA looks enabled but click fails after form validation');
    expect(md).toContain('Uncaught ReferenceError: cartTotal is not defined');
    expect(md).toContain('POST https://shop.example/api/checkout');
    expect(md).toContain('await page.click');
  });
});

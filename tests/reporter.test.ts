import { describe, expect, it } from 'vitest';
import {
  allStepsPassed,
  correlateSteps,
  parsePlaywrightReport,
} from '../src/reporter.js';
import type { TestSuite } from '../src/types.js';

const sample = {
  stats: { duration: 1234 },
  suites: [
    {
      title: 'login.spec.ts',
      file: 'login.spec.ts',
      specs: [
        {
          title: 'login flow',
          file: 'login.spec.ts',
          tests: [
            {
              results: [
                {
                  status: 'passed',
                  duration: 1200,
                  steps: [
                    { title: 'Before Hooks', duration: 10 },
                    { title: 'page.goto(https://example.com)', duration: 50 },
                    { title: 'page.fill([name="username"])', duration: 20 },
                    { title: 'page.click([data-testid="submit"])', duration: 30 },
                    { title: 'expect(locator).toBeVisible()', duration: 5 },
                    { title: 'After Hooks', duration: 2 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

const failing = {
  stats: { duration: 500 },
  suites: [
    {
      title: 'broken.spec.ts',
      specs: [
        {
          title: 'fails at click',
          tests: [
            {
              results: [
                {
                  status: 'failed',
                  duration: 400,
                  error: { message: 'locator not found' },
                  steps: [
                    { title: 'page.goto(/)', duration: 10 },
                    {
                      title: 'page.click(#missing)',
                      duration: 390,
                      error: { message: 'locator not found' },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe('parsePlaywrightReport', () => {
  it('returns empty summary for malformed JSON string', () => {
    const r = parsePlaywrightReport('not json');
    expect(r.totalSpecs).toBe(0);
    expect(r.specs).toEqual([]);
  });

  it('accepts a string payload', () => {
    const r = parsePlaywrightReport(JSON.stringify(sample));
    expect(r.totalSpecs).toBe(1);
    expect(r.passed).toBe(1);
  });

  it('filters out framework Before/After hook steps', () => {
    const r = parsePlaywrightReport(sample);
    const titles = r.specs[0].steps.map((s) => s.title);
    expect(titles.some((t) => t.includes('Before Hooks'))).toBe(false);
    expect(titles.some((t) => t.includes('After Hooks'))).toBe(false);
    expect(titles).toEqual([
      'page.goto(https://example.com)',
      'page.fill([name="username"])',
      'page.click([data-testid="submit"])',
      'expect(locator).toBeVisible()',
    ]);
  });

  it('rolls up per-spec pass/fail counts', () => {
    const r = parsePlaywrightReport(failing);
    expect(r.failed).toBe(1);
    expect(r.passed).toBe(0);
    expect(r.specs[0].status).toBe('failed');
  });

  it('attaches error message to the failing step', () => {
    const r = parsePlaywrightReport(failing);
    const bad = r.specs[0].steps.find((s) => s.status === 'failed');
    expect(bad?.error).toBe('locator not found');
  });

  it('uses stats.duration when present, else sums spec durations', () => {
    expect(parsePlaywrightReport(sample).totalDurationMs).toBe(1234);
    const noStats = { suites: sample.suites };
    const r2 = parsePlaywrightReport(noStats);
    expect(r2.totalDurationMs).toBe(1200);
  });

  it('walks nested suites', () => {
    const nested = {
      suites: [
        {
          title: 'outer',
          suites: [
            {
              title: 'inner',
              specs: [
                {
                  title: 'deep test',
                  tests: [{ results: [{ status: 'passed', duration: 1, steps: [] }] }],
                },
              ],
            },
          ],
        },
      ],
    };
    const r = parsePlaywrightReport(nested);
    expect(r.totalSpecs).toBe(1);
    expect(r.specs[0].title).toBe('deep test');
  });

  it('handles empty input', () => {
    expect(parsePlaywrightReport({}).totalSpecs).toBe(0);
    expect(parsePlaywrightReport('{}').totalSpecs).toBe(0);
  });

  it('reports a spec as passed when a failed first attempt is recovered on retry', () => {
    const flaky = {
      suites: [
        {
          specs: [
            {
              title: 'retry example',
              tests: [
                {
                  results: [
                    {
                      status: 'failed',
                      duration: 50,
                      error: { message: 'first try failed' },
                      steps: [
                        { title: 'page.goto(/)', duration: 10 },
                        {
                          title: 'page.click(#submit)',
                          duration: 40,
                          error: { message: 'first try failed' },
                        },
                      ],
                    },
                    {
                      status: 'passed',
                      duration: 30,
                      steps: [
                        { title: 'page.goto(/)', duration: 10 },
                        { title: 'page.click(#submit)', duration: 20 },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const r = parsePlaywrightReport(flaky);
    expect(r.passed).toBe(1);
    expect(r.failed).toBe(0);
    expect(r.specs[0].status).toBe('passed');
    expect(r.specs[0].steps).toHaveLength(2);
    expect(r.specs[0].steps.every((s) => s.status === 'passed')).toBe(true);
  });
});

describe('correlateSteps', () => {
  const suite: TestSuite = {
    name: 'login',
    steps: [
      { id: '1', type: 'navigate', url: 'https://example.com' },
      { id: '2', type: 'fill', locator: { strategy: 'name', value: 'username' }, text: 'alice' },
      { id: '3', type: 'fill', locator: { strategy: 'name', value: 'password' }, text: 'x' },
      { id: '4', type: 'click', locator: { strategy: 'testId', value: 'submit' } },
      { id: '5', type: 'assertVisible', locator: { strategy: 'text', value: 'Welcome' } },
    ],
    createdAt: '2026-04-17T00:00:00.000Z',
  };

  it('aligns results to steps by index', () => {
    const r = parsePlaywrightReport(sample);
    const pairs = correlateSteps(suite, r.specs[0]);
    expect(pairs).toHaveLength(5);
    expect(pairs[0].step.id).toBe('1');
    expect(pairs[0].result?.status).toBe('passed');
  });

  it('fills trailing steps with null when spec ended early', () => {
    const short = parsePlaywrightReport(failing);
    const pairs = correlateSteps(suite, short.specs[0]);
    expect(pairs[0].result).not.toBeNull();
    expect(pairs[1].result).not.toBeNull();
    expect(pairs[2].result).toBeNull();
    expect(pairs[4].result).toBeNull();
  });
});

describe('allStepsPassed', () => {
  it('true when every step passed', () => {
    const r = parsePlaywrightReport(sample);
    expect(allStepsPassed(r.specs[0])).toBe(true);
  });

  it('false when any step failed', () => {
    const r = parsePlaywrightReport(failing);
    expect(allStepsPassed(r.specs[0])).toBe(false);
  });
});

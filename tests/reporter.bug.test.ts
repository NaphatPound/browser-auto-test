import { describe, it, expect } from 'vitest';
import { generateBugReport, type ReportSummary, type SpecResult } from '../src/reporter.js';
import type { TestSuite } from '../src/types.js';

describe('generateBugReport', () => {
  const mockSuite: TestSuite = {
    name: 'Login Test',
    steps: [
      { type: 'navigate', url: 'https://example.com' },
      { type: 'click', locator: { strategy: 'css', value: '#login' } },
    ],
  };

  const mockReport: ReportSummary = {
    totalSpecs: 1,
    passed: 0,
    failed: 1,
    skipped: 0,
    totalDurationMs: 100,
    specs: [
      {
        title: 'login failure',
        status: 'failed',
        durationMs: 100,
        steps: [
          { title: 'page.goto', status: 'passed', durationMs: 50 },
          { title: 'page.click', status: 'failed', durationMs: 50, error: 'Target closed' },
        ],
      },
    ],
  };

  it('generates a markdown report for failures', () => {
    const md = generateBugReport(mockSuite, mockReport, 'playwright');
    expect(md).toContain('# Bug Report: Login Test');
    expect(md).toContain('## Spec: login failure');
    expect(md).toContain('**Failed Step**: #2 (click)');
    expect(md).toContain('**Error**: `Target closed`');
    expect(md).toContain('**Generated Code (playwright)**');
    expect(md).toContain('await page.click(\'#login\')');
  });

  it('returns empty string if no failures', () => {
    const passedReport: ReportSummary = {
      ...mockReport,
      passed: 1,
      failed: 0,
      specs: [{ ...mockReport.specs[0], status: 'passed' }],
    };
    const md = generateBugReport(mockSuite, passedReport, 'playwright');
    expect(md).toBe('');
  });
});

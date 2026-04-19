import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildExport, exportSuite, exportFilename } from '../src/exporter.js';
import type { TestSuite } from '../src/types.js';

const suite: TestSuite = {
  name: 'login flow',
  steps: [
    { id: 's1', type: 'navigate', url: 'https://example.com' },
    { id: 's2', type: 'fill', locator: { strategy: 'id', value: 'user' }, text: 'a' },
  ],
  createdAt: new Date().toISOString(),
};

describe('exporter.buildExport', () => {
  it('returns plain generated code when no settings', () => {
    const out = buildExport(suite, 'playwright');
    expect(out).toContain("test('login flow'");
    expect(out).not.toContain('test.use(');
  });

  it('injects test.use() block for playwright when settings provided', () => {
    const out = buildExport(suite, 'playwright', {
      userAgent: 'UA/2.0',
      viewport: { width: 800, height: 600 },
    });
    expect(out).toContain('test.use(');
    expect(out).toContain('"userAgent": "UA/2.0"');
    expect(out).toContain('"viewport"');
    // injected after the import line, before the test() call
    const importIdx = out.indexOf("from '@playwright/test'");
    const useIdx = out.indexOf('test.use(');
    const testIdx = out.indexOf("test('login flow'");
    expect(importIdx).toBeLessThan(useIdx);
    expect(useIdx).toBeLessThan(testIdx);
  });

  it('does not inject test.use() for non-playwright frameworks', () => {
    const cy = buildExport(suite, 'cypress', { userAgent: 'UA' });
    expect(cy).not.toContain('test.use(');
  });

  it('skips injection when settings produce empty use block', () => {
    const out = buildExport(suite, 'playwright', {});
    expect(out).not.toContain('test.use(');
  });
});

describe('exporter.exportFilename', () => {
  it('uses correct extension per framework', () => {
    expect(exportFilename(suite, 'playwright')).toBe('login_flow.spec.ts');
    expect(exportFilename(suite, 'puppeteer')).toBe('login_flow.mjs');
    expect(exportFilename(suite, 'cypress')).toBe('login_flow.cy.js');
  });

  it('falls back to "suite" for empty names', () => {
    expect(exportFilename({ ...suite, name: '' }, 'playwright')).toBe('suite.spec.ts');
  });

  it('sanitizes path traversal attempts', () => {
    const f = exportFilename({ ...suite, name: '../../etc/passwd' }, 'playwright');
    expect(f.includes('..')).toBe(false);
    expect(f.includes('/')).toBe(false);
  });
});

describe('exporter.exportSuite', () => {
  it('writes a file to the output dir, creating it if missing', async () => {
    const base = await mkdtemp(join(tmpdir(), 'bat-export-'));
    const outDir = join(base, 'nested', 'sub');
    try {
      const file = await exportSuite(suite, 'playwright', outDir);
      expect(file).toBe(join(outDir, 'login_flow.spec.ts'));
      const content = await readFile(file, 'utf8');
      expect(content).toContain("test('login flow'");
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it('writes settings into the file when provided', async () => {
    const base = await mkdtemp(join(tmpdir(), 'bat-export-'));
    try {
      const file = await exportSuite(suite, 'playwright', base, {
        userAgent: 'UA/3.0',
      });
      const content = await readFile(file, 'utf8');
      expect(content).toContain('UA/3.0');
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});

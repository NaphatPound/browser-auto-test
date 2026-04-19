import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundleSuites } from '../src/bundle.js';
import type { TestSuite } from '../src/types.js';

const suiteA: TestSuite = {
  name: 'login flow',
  steps: [
    { id: 's1', type: 'navigate', url: 'https://example.com' },
    { id: 's2', type: 'fill', locator: { strategy: 'id', value: 'user' }, text: 'a' },
  ],
  createdAt: new Date().toISOString(),
};

const suiteB: TestSuite = {
  name: 'logout flow',
  steps: [{ id: 'b1', type: 'click', locator: { strategy: 'testId', value: 'logout' } }],
  createdAt: new Date().toISOString(),
};

async function mkdir() {
  return mkdtemp(join(tmpdir(), 'bat-bundle-'));
}

describe('bundleSuites — input validation', () => {
  it('rejects an empty suite array', async () => {
    const dir = await mkdir();
    try {
      await expect(bundleSuites([], 'playwright', dir)).rejects.toThrow(/at least one suite/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects suites that would resolve to the same filename', async () => {
    const dir = await mkdir();
    try {
      const dup: TestSuite = { ...suiteA, name: 'login flow' };
      await expect(bundleSuites([suiteA, dup], 'playwright', dir)).rejects.toThrow(
        /duplicate spec filename/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('bundleSuites — playwright', () => {
  it('writes specs, package.json, playwright.config.ts and a manifest', async () => {
    const dir = await mkdir();
    try {
      const result = await bundleSuites([suiteA, suiteB], 'playwright', dir);

      expect(result.outDir).toBe(dir);
      expect(result.configPath).toBe(join(dir, 'playwright.config.ts'));
      expect(result.packageJsonPath).toBe(join(dir, 'package.json'));
      expect(result.manifestPath).toBe(join(dir, 'bundle.json'));
      // 2 specs + package.json + config + manifest
      expect(result.files).toHaveLength(5);

      // specs land under tests/
      const specA = join(dir, 'tests', 'login_flow.spec.ts');
      const specB = join(dir, 'tests', 'logout_flow.spec.ts');
      const a = await readFile(specA, 'utf8');
      const b = await readFile(specB, 'utf8');
      expect(a).toContain("test('login flow'");
      expect(b).toContain("test('logout flow'");

      // package.json has the right deps + script
      const pkg = JSON.parse(await readFile(result.packageJsonPath, 'utf8'));
      expect(pkg.devDependencies['@playwright/test']).toBeDefined();
      expect(pkg.scripts.test).toBe('playwright test');
      expect(pkg.private).toBe(true);

      // config compiles to a defineConfig() call
      const cfg = await readFile(result.configPath!, 'utf8');
      expect(cfg).toContain("import { defineConfig } from '@playwright/test'");
      expect(cfg).toContain("testDir: './tests'");
      // no settings → no use block
      expect(cfg).not.toContain('use:');

      // manifest enumerates the suites
      const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8'));
      expect(manifest.framework).toBe('playwright');
      expect(manifest.suites).toHaveLength(2);
      expect(manifest.suites[0]).toMatchObject({
        name: 'login flow',
        file: 'tests/login_flow.spec.ts',
        stepCount: 2,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('injects browser settings into both spec and config', async () => {
    const dir = await mkdir();
    try {
      const result = await bundleSuites([suiteA], 'playwright', dir, {
        settings: { userAgent: 'BundleUA/1.0', viewport: { width: 1024, height: 768 } },
        packageName: 'my-bundle',
        version: '1.2.3',
      });
      const cfg = await readFile(result.configPath!, 'utf8');
      expect(cfg).toContain('BundleUA/1.0');
      expect(cfg).toContain('"width": 1024');

      const spec = await readFile(join(dir, 'tests', 'login_flow.spec.ts'), 'utf8');
      expect(spec).toContain('test.use(');
      expect(spec).toContain('BundleUA/1.0');

      const pkg = JSON.parse(await readFile(result.packageJsonPath, 'utf8'));
      expect(pkg.name).toBe('my-bundle');
      expect(pkg.version).toBe('1.2.3');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('bundleSuites — puppeteer', () => {
  it('writes .mjs specs and a module-type package.json with no separate config file', async () => {
    const dir = await mkdir();
    try {
      const result = await bundleSuites([suiteA], 'puppeteer', dir);
      expect(result.configPath).toBeUndefined();

      const spec = await readFile(join(dir, 'tests', 'login_flow.mjs'), 'utf8');
      expect(spec).toContain("import puppeteer from 'puppeteer'");

      const pkg = JSON.parse(await readFile(result.packageJsonPath, 'utf8'));
      expect(pkg.type).toBe('module');
      expect(pkg.devDependencies.puppeteer).toBeDefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('bundleSuites — cypress', () => {
  it('writes specs under cypress/e2e + a cypress.config.js', async () => {
    const dir = await mkdir();
    try {
      const result = await bundleSuites([suiteA, suiteB], 'cypress', dir);
      expect(result.configPath).toBe(join(dir, 'cypress.config.js'));

      // confirm files exist on disk where expected
      await stat(join(dir, 'cypress', 'e2e', 'login_flow.cy.js'));
      await stat(join(dir, 'cypress', 'e2e', 'logout_flow.cy.js'));

      const cfg = await readFile(result.configPath!, 'utf8');
      expect(cfg).toContain("require('cypress')");
      expect(cfg).toContain("specPattern: 'cypress/e2e/**/*.cy.js'");

      const pkg = JSON.parse(await readFile(result.packageJsonPath, 'utf8'));
      expect(pkg.scripts.test).toBe('cypress run');
      expect(pkg.devDependencies.cypress).toBeDefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

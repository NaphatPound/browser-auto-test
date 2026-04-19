import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { Framework, TestSuite } from './types.js';
import type { BrowserSettings } from './settings.js';
import { toPlaywrightUse } from './settings.js';
import { buildExport, exportFilename } from './exporter.js';
import { zipDirectory, type ZipResult } from './zip.js';

export interface BundleResult {
  /** Absolute paths of every file written, in deterministic order. */
  files: string[];
  outDir: string;
  packageJsonPath: string;
  configPath?: string;
  manifestPath: string;
}

export interface BundleOptions {
  settings?: BrowserSettings;
  /** Override `name` in the generated `package.json`. */
  packageName?: string;
  /** Override `version` in the generated `package.json`. */
  version?: string;
}

const DEPS: Record<Framework, Record<string, string>> = {
  playwright: { '@playwright/test': '^1.44.0' },
  puppeteer: { puppeteer: '^22.0.0' },
  cypress: { cypress: '^13.0.0' },
};

const SCRIPTS: Record<Framework, Record<string, string>> = {
  playwright: { test: 'playwright test' },
  puppeteer: { test: 'node --experimental-vm-modules tests/*.mjs' },
  cypress: { test: 'cypress run' },
};

const SUBDIR: Record<Framework, string> = {
  playwright: 'tests',
  puppeteer: 'tests',
  cypress: 'cypress/e2e',
};

function buildPackageJson(
  framework: Framework,
  opts: BundleOptions,
): string {
  const pkg = {
    name: opts.packageName ?? `auto-test-bundle-${framework}`,
    version: opts.version ?? '0.0.0',
    private: true,
    type: framework === 'puppeteer' ? 'module' : 'commonjs',
    scripts: SCRIPTS[framework],
    devDependencies: DEPS[framework],
  };
  return JSON.stringify(pkg, null, 2) + '\n';
}

function buildPlaywrightConfig(settings?: BrowserSettings): string {
  const use = settings ? toPlaywrightUse(settings) : {};
  const useBlock = Object.keys(use).length > 0
    ? `  use: ${JSON.stringify(use, null, 2).replace(/\n/g, '\n  ')},\n`
    : '';
  return `import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
${useBlock}});
`;
}

function buildCypressConfig(): string {
  return `const { defineConfig } = require('cypress');

module.exports = defineConfig({
  e2e: {
    specPattern: 'cypress/e2e/**/*.cy.js',
    supportFile: false,
  },
});
`;
}

function rejectDuplicateNames(suites: TestSuite[], framework: Framework): void {
  const seen = new Set<string>();
  for (const s of suites) {
    const f = exportFilename(s, framework);
    if (seen.has(f)) {
      throw new Error(`bundle: duplicate spec filename "${f}" — rename suites to disambiguate`);
    }
    seen.add(f);
  }
}

/**
 * Bundle multiple suites into a self-contained, runnable project directory.
 * Writes per-suite specs, a framework-appropriate `package.json`, an optional
 * config file, and a `bundle.json` manifest. The caller can then `cd outDir && npm install && npm test`.
 */
export async function bundleSuites(
  suites: TestSuite[],
  framework: Framework,
  outDir: string,
  opts: BundleOptions = {},
): Promise<BundleResult> {
  if (!Array.isArray(suites) || suites.length === 0) {
    throw new Error('bundle: at least one suite is required');
  }
  rejectDuplicateNames(suites, framework);

  const absOut = path.resolve(outDir);
  const specsDir = path.join(absOut, SUBDIR[framework]);
  await mkdir(specsDir, { recursive: true });

  const written: string[] = [];

  for (const suite of suites) {
    const file = path.join(specsDir, exportFilename(suite, framework));
    const content = buildExport(suite, framework, opts.settings);
    await writeFile(file, content, 'utf8');
    written.push(file);
  }

  const packageJsonPath = path.join(absOut, 'package.json');
  await writeFile(packageJsonPath, buildPackageJson(framework, opts), 'utf8');
  written.push(packageJsonPath);

  let configPath: string | undefined;
  if (framework === 'playwright') {
    configPath = path.join(absOut, 'playwright.config.ts');
    await writeFile(configPath, buildPlaywrightConfig(opts.settings), 'utf8');
    written.push(configPath);
  } else if (framework === 'cypress') {
    configPath = path.join(absOut, 'cypress.config.js');
    await writeFile(configPath, buildCypressConfig(), 'utf8');
    written.push(configPath);
  }

  const manifest = {
    framework,
    createdAt: new Date().toISOString(),
    suites: suites.map((s) => ({
      name: s.name,
      file: path.relative(absOut, path.join(specsDir, exportFilename(s, framework))),
      stepCount: s.steps.length,
    })),
  };
  const manifestPath = path.join(absOut, 'bundle.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  written.push(manifestPath);

  return {
    files: written,
    outDir: absOut,
    packageJsonPath,
    configPath,
    manifestPath,
  };
}

export interface ZipBundleResult {
  bundle: BundleResult;
  zip: ZipResult;
}

/**
 * Bundle multiple suites and pack the resulting directory into a `.zip`.
 * The bundle directory is kept on disk; callers can delete it after.
 */
export async function zipBundle(
  suites: TestSuite[],
  framework: Framework,
  outDir: string,
  zipPath: string,
  opts: BundleOptions = {},
): Promise<ZipBundleResult> {
  const bundle = await bundleSuites(suites, framework, outDir, opts);
  const zip = await zipDirectory(bundle.outDir, zipPath);
  return { bundle, zip };
}

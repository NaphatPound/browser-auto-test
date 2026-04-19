import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { Framework, TestSuite } from './types.js';
import type { BrowserSettings } from './settings.js';
import { toPlaywrightUse } from './settings.js';
import { generate } from './codegen.js';

const EXT: Record<Framework, string> = {
  playwright: '.spec.ts',
  puppeteer: '.mjs',
  cypress: '.cy.js',
};

function safeName(name: string): string {
  return (name || 'suite').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) || 'suite';
}

/** Build the file content for export, optionally injecting a Playwright config block. */
export function buildExport(
  suite: TestSuite,
  framework: Framework,
  settings?: BrowserSettings,
): string {
  const code = generate(suite, framework);
  if (framework !== 'playwright' || !settings) return code;
  const use = toPlaywrightUse(settings);
  if (Object.keys(use).length === 0) return code;
  const useBlock = `test.use(${JSON.stringify(use, null, 2)});\n\n`;
  // insert after the import line so test.use sits at module scope
  return code.replace(
    /^(import \{ test, expect \} from '@playwright\/test';\n\n)/,
    `$1${useBlock}`,
  );
}

/** Write the suite to a file. Creates parent directories as needed. */
export async function exportSuite(
  suite: TestSuite,
  framework: Framework,
  outDir: string,
  settings?: BrowserSettings,
): Promise<string> {
  await mkdir(outDir, { recursive: true });
  const file = path.join(outDir, `${safeName(suite.name)}${EXT[framework]}`);
  const content = buildExport(suite, framework, settings);
  await writeFile(file, content, 'utf8');
  return file;
}

export function exportFilename(suite: TestSuite, framework: Framework): string {
  return `${safeName(suite.name)}${EXT[framework]}`;
}

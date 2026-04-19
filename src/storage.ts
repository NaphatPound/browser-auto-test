import { readFile, writeFile } from 'node:fs/promises';
import type { TestSuite } from './types.js';

export async function saveSuite(filePath: string, suite: TestSuite): Promise<void> {
  await writeFile(filePath, JSON.stringify(suite, null, 2), 'utf8');
}

export async function loadSuite(filePath: string): Promise<TestSuite> {
  const raw = await readFile(filePath, 'utf8');
  const data = JSON.parse(raw) as TestSuite;
  if (!data || typeof data !== 'object' || !Array.isArray(data.steps)) {
    throw new Error(`Invalid test suite at ${filePath}`);
  }
  return data;
}

export function serializeSuite(suite: TestSuite): string {
  return JSON.stringify(suite, null, 2);
}

export function parseSuite(json: string): TestSuite {
  const data = JSON.parse(json) as TestSuite;
  if (!data || typeof data !== 'object' || !Array.isArray(data.steps)) {
    throw new Error('Invalid test suite JSON');
  }
  return data;
}

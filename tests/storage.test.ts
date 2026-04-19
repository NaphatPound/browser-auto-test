import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadSuite, parseSuite, saveSuite, serializeSuite } from '../src/storage.js';
import type { TestSuite } from '../src/types.js';

const sample: TestSuite = {
  name: 'roundtrip',
  baseUrl: 'https://example.com',
  createdAt: '2026-04-17T00:00:00.000Z',
  steps: [
    { id: '1', type: 'navigate', url: 'https://example.com' },
    { id: '2', type: 'click', locator: { strategy: 'id', value: 'btn' } },
  ],
};

describe('Storage', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bat-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('saves and reloads a suite', async () => {
    const path = join(dir, 'suite.json');
    await saveSuite(path, sample);
    const loaded = await loadSuite(path);
    expect(loaded).toEqual(sample);
  });

  it('serialize/parse roundtrip', () => {
    const json = serializeSuite(sample);
    expect(parseSuite(json)).toEqual(sample);
  });

  it('rejects invalid JSON shape', () => {
    expect(() => parseSuite('{"foo":1}')).toThrow();
  });
});

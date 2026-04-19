import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { inflateRawSync } from 'node:zlib';
import { buildZip, zipDirectory } from '../src/zip.js';
import { zipBundle } from '../src/bundle.js';
import type { TestSuite } from '../src/types.js';

async function tmp() {
  return mkdtemp(join(tmpdir(), 'bat-zip-'));
}

interface ParsedEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  crc: number;
  data: Buffer;
}

/**
 * Minimal ZIP reader that walks the central directory, verifies signatures,
 * and DEFLATE-inflates each entry. Used only by tests so we can validate our
 * archives without pulling in a zip library.
 */
function parseZip(buf: Buffer): ParsedEntry[] {
  // Locate End of Central Directory (EOCD) signature 0x06054b50 scanning back.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('test: EOCD not found');
  const total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (cdOffset + cdSize > buf.length) throw new Error('test: CD overruns buffer');

  const out: ParsedEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < total; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`test: bad CD sig at ${p}`);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compSize = buf.readUInt32LE(p + 20);
    const uncompSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');

    // Walk local header to find file data start.
    if (buf.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`test: bad local sig at ${localOffset}`);
    }
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.slice(dataStart, dataStart + compSize);
    let data: Buffer;
    if (method === 0) {
      data = raw;
    } else if (method === 8) {
      data = inflateRawSync(raw);
    } else {
      throw new Error(`test: unsupported method ${method}`);
    }
    if (data.length !== uncompSize) {
      throw new Error(`test: size mismatch ${data.length} vs ${uncompSize}`);
    }
    out.push({ name, method, compressedSize: compSize, uncompressedSize: uncompSize, crc, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

describe('buildZip', () => {
  it('rejects an empty entry list', () => {
    expect(() => buildZip([])).toThrow(/at least one entry/);
  });

  it('rejects duplicate entry names', () => {
    expect(() =>
      buildZip([
        { name: 'a.txt', data: Buffer.from('x') },
        { name: 'a.txt', data: Buffer.from('y') },
      ]),
    ).toThrow(/duplicate/);
  });

  it('rejects names containing ".."', () => {
    expect(() =>
      buildZip([{ name: '../evil.txt', data: Buffer.from('bad') }]),
    ).toThrow(/\.\./);
  });

  it('round-trips UTF-8 filenames and content', () => {
    const zip = buildZip([
      { name: 'hello.txt', data: Buffer.from('Hello, world!') },
      { name: 'nested/ภาษาไทย.txt', data: Buffer.from('สวัสดี', 'utf8') },
    ]);
    const entries = parseZip(zip);
    expect(entries).toHaveLength(2);
    expect(entries[0].name).toBe('hello.txt');
    expect(entries[0].data.toString('utf8')).toBe('Hello, world!');
    expect(entries[1].name).toBe('nested/ภาษาไทย.txt');
    expect(entries[1].data.toString('utf8')).toBe('สวัสดี');
  });

  it('stores small or incompressible payloads with method=0 (STORE)', () => {
    // Random bytes don't compress — force STORE fallback.
    const random = Buffer.from(Array.from({ length: 64 }, () => Math.floor(Math.random() * 256)));
    const zip = buildZip([{ name: 'rand.bin', data: random }]);
    const [entry] = parseZip(zip);
    expect(entry.method).toBe(0);
    expect(entry.compressedSize).toBe(random.length);
  });

  it('uses DEFLATE when it actually reduces size', () => {
    const repeat = Buffer.from('A'.repeat(4096));
    const zip = buildZip([{ name: 'compressible.txt', data: repeat }]);
    const [entry] = parseZip(zip);
    expect(entry.method).toBe(8);
    expect(entry.compressedSize).toBeLessThan(repeat.length);
    expect(entry.data.equals(repeat)).toBe(true);
  });

  it('honours store:true even when deflate would help', () => {
    const repeat = Buffer.from('A'.repeat(4096));
    const zip = buildZip([{ name: 'forced.txt', data: repeat, store: true }]);
    const [entry] = parseZip(zip);
    expect(entry.method).toBe(0);
    expect(entry.compressedSize).toBe(repeat.length);
  });

  it('normalizes backslashes and strips leading slashes', () => {
    const zip = buildZip([
      { name: '/absolute/path.txt', data: Buffer.from('x') },
      { name: 'win\\style\\path.txt', data: Buffer.from('y') },
    ]);
    const names = parseZip(zip).map((e) => e.name);
    expect(names).toEqual(['absolute/path.txt', 'win/style/path.txt']);
  });
});

describe('zipDirectory', () => {
  it('walks a directory recursively and preserves content', async () => {
    const src = await tmp();
    const outZip = join(await tmp(), 'out.zip');
    try {
      await mkdir(join(src, 'sub'), { recursive: true });
      await writeFile(join(src, 'a.txt'), 'alpha');
      await writeFile(join(src, 'sub', 'b.txt'), 'beta');

      const res = await zipDirectory(src, outZip);
      expect(res.entries).toBe(2);
      expect(res.size).toBeGreaterThan(0);

      const buf = await readFile(outZip);
      const entries = parseZip(buf);
      const byName = new Map(entries.map((e) => [e.name, e.data.toString('utf8')]));
      expect(byName.get('a.txt')).toBe('alpha');
      expect(byName.get('sub/b.txt')).toBe('beta');
    } finally {
      await rm(src, { recursive: true, force: true });
      await rm(outZip, { force: true });
    }
  });

  it('produces deterministic entry order (lexicographic per directory)', async () => {
    const src = await tmp();
    const outZip = join(await tmp(), 'sorted.zip');
    try {
      await writeFile(join(src, 'c.txt'), 'c');
      await writeFile(join(src, 'a.txt'), 'a');
      await writeFile(join(src, 'b.txt'), 'b');

      await zipDirectory(src, outZip);
      const names = parseZip(await readFile(outZip)).map((e) => e.name);
      expect(names).toEqual(['a.txt', 'b.txt', 'c.txt']);
    } finally {
      await rm(src, { recursive: true, force: true });
      await rm(outZip, { force: true });
    }
  });

  it('rejects an empty directory', async () => {
    const src = await tmp();
    try {
      await expect(zipDirectory(src, join(src, 'empty.zip'))).rejects.toThrow(/no files/);
    } finally {
      await rm(src, { recursive: true, force: true });
    }
  });

  it('is compatible with the system `unzip` utility when available', async () => {
    // Skip if `unzip` is not on PATH (keeps the test portable).
    const probe = spawnSync('unzip', ['-v'], { stdio: 'ignore' });
    if (probe.status !== 0) return;

    const src = await tmp();
    const extract = await tmp();
    const outZip = join(await tmp(), 'system.zip');
    try {
      await writeFile(join(src, 'readme.md'), '# hello');
      await mkdir(join(src, 'nested'));
      await writeFile(join(src, 'nested', 'note.txt'), 'compressed payload '.repeat(100));
      await zipDirectory(src, outZip);

      const r = spawnSync('unzip', ['-o', outZip, '-d', extract], { stdio: 'ignore' });
      expect(r.status).toBe(0);
      const readme = await readFile(join(extract, 'readme.md'), 'utf8');
      expect(readme).toBe('# hello');
      const note = await readFile(join(extract, 'nested', 'note.txt'), 'utf8');
      expect(note).toBe('compressed payload '.repeat(100));
    } finally {
      await rm(src, { recursive: true, force: true });
      await rm(extract, { recursive: true, force: true });
      await rm(outZip, { force: true });
    }
  });
});

describe('zipBundle', () => {
  const suite: TestSuite = {
    name: 'login flow',
    steps: [{ id: 's1', type: 'navigate', url: 'https://example.com' }],
    createdAt: new Date().toISOString(),
  };

  it('bundles and zips a suite in one call', async () => {
    const out = await tmp();
    const zipPath = join(await tmp(), 'bundle.zip');
    try {
      const { bundle, zip } = await zipBundle([suite], 'playwright', out, zipPath);
      expect(bundle.files.length).toBeGreaterThanOrEqual(3);
      expect(zip.outPath).toBe(zipPath);
      expect(zip.entries).toBe(bundle.files.length);

      const entries = parseZip(await readFile(zipPath));
      const names = entries.map((e) => e.name).sort();
      expect(names).toContain('tests/login_flow.spec.ts');
      expect(names).toContain('package.json');
      expect(names).toContain('playwright.config.ts');
      expect(names).toContain('bundle.json');

      const pkg = entries.find((e) => e.name === 'package.json')!;
      const parsed = JSON.parse(pkg.data.toString('utf8'));
      expect(parsed.devDependencies['@playwright/test']).toBeDefined();
    } finally {
      await rm(out, { recursive: true, force: true });
      await rm(zipPath, { force: true });
    }
  });
});

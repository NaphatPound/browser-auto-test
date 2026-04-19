import { readFile, writeFile, stat, readdir } from 'node:fs/promises';
import { deflateRawSync, crc32 } from 'node:zlib';
import * as path from 'node:path';

export interface ZipEntry {
  /** POSIX path inside the archive (always uses `/`). */
  name: string;
  data: Buffer;
  /** `true` forces STORE (no compression); otherwise DEFLATE is used when it shrinks the payload. */
  store?: boolean;
}

export interface ZipResult {
  outPath: string;
  entries: number;
  /** Total bytes written to disk. */
  size: number;
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

const VERSION = 20;
const FLAGS = 0x0800;

function dosTime(d: Date): { time: number; date: number } {
  const time =
    ((d.getHours() & 0x1f) << 11) |
    ((d.getMinutes() & 0x3f) << 5) |
    ((Math.floor(d.getSeconds() / 2)) & 0x1f);
  const year = d.getFullYear() - 1980;
  const date =
    ((year & 0x7f) << 9) |
    (((d.getMonth() + 1) & 0x0f) << 5) |
    (d.getDate() & 0x1f);
  return { time, date };
}

function normalizeName(name: string): string {
  const n = name.replace(/\\/g, '/').replace(/^\/+/, '');
  if (n.includes('..')) {
    throw new Error(`zip: entry name cannot contain ".." (${name})`);
  }
  return n;
}

interface PreparedEntry {
  name: string;
  nameBytes: Buffer;
  method: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  compressedData: Buffer;
  time: number;
  date: number;
  localHeaderOffset: number;
}

function prepareEntry(
  entry: ZipEntry,
  now: Date,
  offset: number,
): PreparedEntry {
  const name = normalizeName(entry.name);
  const nameBytes = Buffer.from(name, 'utf8');
  const uncompressedSize = entry.data.length;
  const crc = crc32(entry.data);

  let method = METHOD_STORE;
  let compressedData = entry.data;
  if (!entry.store && uncompressedSize > 0) {
    const deflated = deflateRawSync(entry.data);
    if (deflated.length < uncompressedSize) {
      method = METHOD_DEFLATE;
      compressedData = deflated;
    }
  }

  const { time, date } = dosTime(now);
  return {
    name,
    nameBytes,
    method,
    crc,
    compressedSize: compressedData.length,
    uncompressedSize,
    compressedData,
    time,
    date,
    localHeaderOffset: offset,
  };
}

function buildLocalHeader(e: PreparedEntry): Buffer {
  const buf = Buffer.alloc(30 + e.nameBytes.length);
  buf.writeUInt32LE(SIG_LOCAL, 0);
  buf.writeUInt16LE(VERSION, 4);
  buf.writeUInt16LE(FLAGS, 6);
  buf.writeUInt16LE(e.method, 8);
  buf.writeUInt16LE(e.time, 10);
  buf.writeUInt16LE(e.date, 12);
  buf.writeUInt32LE(e.crc, 14);
  buf.writeUInt32LE(e.compressedSize, 18);
  buf.writeUInt32LE(e.uncompressedSize, 22);
  buf.writeUInt16LE(e.nameBytes.length, 26);
  buf.writeUInt16LE(0, 28);
  e.nameBytes.copy(buf, 30);
  return buf;
}

function buildCentralHeader(e: PreparedEntry): Buffer {
  const buf = Buffer.alloc(46 + e.nameBytes.length);
  buf.writeUInt32LE(SIG_CENTRAL, 0);
  buf.writeUInt16LE(VERSION, 4);
  buf.writeUInt16LE(VERSION, 6);
  buf.writeUInt16LE(FLAGS, 8);
  buf.writeUInt16LE(e.method, 10);
  buf.writeUInt16LE(e.time, 12);
  buf.writeUInt16LE(e.date, 14);
  buf.writeUInt32LE(e.crc, 16);
  buf.writeUInt32LE(e.compressedSize, 20);
  buf.writeUInt32LE(e.uncompressedSize, 24);
  buf.writeUInt16LE(e.nameBytes.length, 28);
  buf.writeUInt16LE(0, 30);
  buf.writeUInt16LE(0, 32);
  buf.writeUInt16LE(0, 34);
  buf.writeUInt16LE(0, 36);
  buf.writeUInt32LE(0, 38);
  buf.writeUInt32LE(e.localHeaderOffset, 42);
  e.nameBytes.copy(buf, 46);
  return buf;
}

function buildEocd(
  entryCount: number,
  centralSize: number,
  centralOffset: number,
): Buffer {
  const buf = Buffer.alloc(22);
  buf.writeUInt32LE(SIG_EOCD, 0);
  buf.writeUInt16LE(0, 4);
  buf.writeUInt16LE(0, 6);
  buf.writeUInt16LE(entryCount, 8);
  buf.writeUInt16LE(entryCount, 10);
  buf.writeUInt32LE(centralSize, 12);
  buf.writeUInt32LE(centralOffset, 16);
  buf.writeUInt16LE(0, 20);
  return buf;
}

/**
 * Build a ZIP archive in memory from the given entries.
 * Entries are stored in the order given. Duplicate names are rejected.
 */
export function buildZip(entries: ZipEntry[], now: Date = new Date()): Buffer {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('zip: at least one entry is required');
  }
  const seen = new Set<string>();
  const prepared: PreparedEntry[] = [];
  const localChunks: Buffer[] = [];
  let offset = 0;
  for (const raw of entries) {
    const e = prepareEntry(raw, now, offset);
    if (seen.has(e.name)) {
      throw new Error(`zip: duplicate entry name "${e.name}"`);
    }
    seen.add(e.name);
    const header = buildLocalHeader(e);
    localChunks.push(header, e.compressedData);
    offset += header.length + e.compressedData.length;
    prepared.push(e);
  }
  const centralOffset = offset;
  const centralChunks = prepared.map(buildCentralHeader);
  const centralSize = centralChunks.reduce((a, b) => a + b.length, 0);
  const eocd = buildEocd(prepared.length, centralSize, centralOffset);
  return Buffer.concat([...localChunks, ...centralChunks, eocd]);
}

async function walk(dir: string, rel = ''): Promise<Array<{ rel: string; full: string }>> {
  const out: Array<{ rel: string; full: string }> = [];
  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    const r = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) {
      const sub = await walk(full, r);
      out.push(...sub);
    } else if (ent.isFile()) {
      out.push({ rel: r, full });
    }
  }
  return out;
}

/**
 * Recursively zip a directory tree into `outPath`. File order is
 * deterministic (lexicographic per directory). Returns the resulting size.
 */
export async function zipDirectory(
  srcDir: string,
  outPath: string,
  now: Date = new Date(),
): Promise<ZipResult> {
  const st = await stat(srcDir);
  if (!st.isDirectory()) {
    throw new Error(`zip: ${srcDir} is not a directory`);
  }
  const files = await walk(srcDir);
  if (files.length === 0) {
    throw new Error(`zip: ${srcDir} contains no files`);
  }
  const entries: ZipEntry[] = [];
  for (const f of files) {
    const data = await readFile(f.full);
    entries.push({ name: f.rel, data });
  }
  const buf = buildZip(entries, now);
  await writeFile(outPath, buf);
  return { outPath: path.resolve(outPath), entries: entries.length, size: buf.length };
}

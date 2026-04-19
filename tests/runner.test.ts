import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCommand, writeSpec, runSpec } from '../src/runner.js';
import type { TestSuite } from '../src/types.js';

const suite: TestSuite = {
  name: 'sample',
  steps: [
    { id: 's1', type: 'navigate', url: 'https://example.com' },
    { id: 's2', type: 'click', locator: { strategy: 'id', value: 'go' } },
  ],
  createdAt: new Date().toISOString(),
};

describe('runner.buildCommand', () => {
  it('builds playwright command', () => {
    const { cmd, args } = buildCommand('playwright', '/tmp/foo.spec.ts');
    expect(cmd).toBe('npx');
    expect(args).toEqual(['playwright', 'test', '/tmp/foo.spec.ts']);
  });

  it('builds puppeteer command', () => {
    const { cmd, args } = buildCommand('puppeteer', '/tmp/foo.mjs');
    expect(cmd).toBe('node');
    expect(args).toEqual(['/tmp/foo.mjs']);
  });

  it('builds cypress command', () => {
    const { cmd, args } = buildCommand('cypress', '/tmp/foo.cy.js');
    expect(cmd).toBe('npx');
    expect(args).toEqual(['cypress', 'run', '--spec', '/tmp/foo.cy.js']);
  });
});

describe('runner.writeSpec', () => {
  it('writes a playwright spec file with correct extension', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bat-test-'));
    try {
      const file = await writeSpec(suite, 'playwright', dir);
      expect(file.endsWith('.spec.ts')).toBe(true);
      const code = await readFile(file, 'utf8');
      expect(code).toContain("test('sample'");
      expect(code).toContain('https://example.com');
      const s = await stat(file);
      expect(s.size).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('writes a puppeteer spec with .mjs extension', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bat-test-'));
    try {
      const file = await writeSpec(suite, 'puppeteer', dir);
      expect(file.endsWith('.mjs')).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('sanitizes suite names with special chars', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bat-test-'));
    try {
      const dirty: TestSuite = { ...suite, name: '../../etc/pwn me!' };
      const file = await writeSpec(dirty, 'playwright', dir);
      expect(file.includes('..')).toBe(false);
      expect(file.includes('/etc/')).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('runner.runSpec', () => {
  it('captures stdout and exit 0 from a successful command', async () => {
    let streamed = '';
    const result = await runSpec('hello-from-runner', 'playwright', {
      command: 'node',
      args: ['-e', "process.stdout.write('hello-from-runner')"],
      onStdout: (c) => (streamed += c),
    });
    expect(result.exitCode).toBe(0);
    expect(result.passed).toBe(true);
    expect(result.stdout).toContain('hello-from-runner');
    expect(streamed).toContain('hello-from-runner');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('reports nonzero exit and captures stderr from a failing command', async () => {
    const result = await runSpec('x', 'playwright', {
      command: 'node',
      args: ['-e', "process.stderr.write('boom'); process.exit(2)"],
    });
    expect(result.exitCode).toBe(2);
    expect(result.passed).toBe(false);
    expect(result.stderr).toContain('boom');
  });

  it('returns exitCode -1 when the command cannot be spawned', async () => {
    const result = await runSpec('x', 'playwright', {
      command: '/no/such/binary/at/all',
      args: [],
    });
    expect(result.passed).toBe(false);
    expect(result.exitCode).toBe(-1);
  });

  it('honors timeoutMs by killing long-running processes', async () => {
    const result = await runSpec('x', 'playwright', {
      command: 'node',
      args: ['-e', 'setTimeout(()=>{}, 10000)'],
      timeoutMs: 100,
    });
    expect(result.passed).toBe(false);
  });

  it('appends extraArgs after the base args', async () => {
    const result = await runSpec('x', 'playwright', {
      command: 'node',
      args: ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', '--'],
      extraArgs: ['first-extra', 'second-extra'],
    });
    expect(result.exitCode).toBe(0);
    const argv = JSON.parse(result.stdout);
    expect(argv).toContain('first-extra');
    expect(argv).toContain('second-extra');
    // Extra args arrive after the base args (they are "appended", not prepended).
    expect(argv.indexOf('first-extra')).toBeLessThan(argv.indexOf('second-extra'));
  });

  it('merges env vars on top of process.env (parent vars still present)', async () => {
    process.env.BAT_PARENT_VAR = 'parent-value';
    try {
      const result = await runSpec('x', 'playwright', {
        command: 'node',
        args: [
          '-e',
          "process.stdout.write(JSON.stringify({ child: process.env.BAT_CHILD_VAR, parent: process.env.BAT_PARENT_VAR }))",
        ],
        env: { BAT_CHILD_VAR: 'child-value' },
      });
      expect(result.exitCode).toBe(0);
      const envSeen = JSON.parse(result.stdout);
      expect(envSeen.child).toBe('child-value');
      expect(envSeen.parent).toBe('parent-value');
    } finally {
      delete process.env.BAT_PARENT_VAR;
    }
  });
});

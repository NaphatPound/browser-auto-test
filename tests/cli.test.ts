import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, runCli, type CliIO } from '../src/cli.js';
import type { TestSuite } from '../src/types.js';

const suite: TestSuite = {
  name: 'login flow',
  steps: [
    { id: 's1', type: 'navigate', url: 'https://example.com' },
    { id: 's2', type: 'fill', locator: { strategy: 'id', value: 'user' }, text: 'alice' },
    { id: 's3', type: 'click', locator: { strategy: 'testId', value: 'submit' } },
  ],
  createdAt: '2026-04-17T00:00:00.000Z',
};

const suite2: TestSuite = {
  name: 'logout flow',
  steps: [{ id: 'b1', type: 'click', locator: { strategy: 'testId', value: 'logout' } }],
  createdAt: '2026-04-17T00:00:00.000Z',
};

function makeIO(): { io: CliIO; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIO = {
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    readFile: async (p) => readFile(p, 'utf8'),
    writeFile: async (p, data) => {
      await writeFile(p, data, 'utf8');
    },
    mkdir: async () => {
      /* tests don't need mkdir here */
    },
  };
  return { io, out, err };
}

async function tmp() {
  return mkdtemp(join(tmpdir(), 'bat-cli-'));
}

async function writeSuite(dir: string, file: string, s: TestSuite): Promise<string> {
  const p = join(dir, file);
  await writeFile(p, JSON.stringify(s), 'utf8');
  return p;
}

describe('parseArgs', () => {
  it('extracts command, positionals, and flags', () => {
    const a = parseArgs(['gen', 'a.json', '--framework', 'playwright', '--out', 'out.spec.ts']);
    expect(a.command).toBe('gen');
    expect(a.positional).toEqual(['a.json']);
    expect(a.flags).toEqual({ framework: 'playwright', out: 'out.spec.ts' });
  });

  it('treats trailing --flag with no value as boolean true', () => {
    const a = parseArgs(['gen', 'a.json', '--help']);
    expect(a.flags.help).toBe(true);
  });

  it('allows flags before positionals', () => {
    const a = parseArgs(['bundle', '--framework', 'playwright', '--out', 'd', 'x.json', 'y.json']);
    expect(a.positional).toEqual(['x.json', 'y.json']);
    expect(a.flags.framework).toBe('playwright');
  });

  it('treats a leading --flag as a flag, not a command', () => {
    const a = parseArgs(['--version']);
    expect(a.command).toBe('');
    expect(a.flags.version).toBe(true);
  });
});

describe('runCli — help / version / unknown', () => {
  it('--version prints version to stdout and exits 0', async () => {
    const { io, out } = makeIO();
    const code = await runCli(['--version'], io);
    expect(code).toBe(0);
    expect(out.join('')).toMatch(/^\d+\.\d+\.\d+\n$/);
  });

  it('no args prints usage and exits 0', async () => {
    const { io, out } = makeIO();
    const code = await runCli([], io);
    expect(code).toBe(0);
    expect(out.join('')).toContain('Usage:');
  });

  it('--help prints usage and exits 0', async () => {
    const { io, out } = makeIO();
    const code = await runCli(['--help'], io);
    expect(code).toBe(0);
    expect(out.join('')).toContain('Usage:');
  });

  it('unknown command writes to stderr and exits 2', async () => {
    const { io, err } = makeIO();
    const code = await runCli(['hotdog'], io);
    expect(code).toBe(2);
    expect(err.join('')).toContain('unknown command');
  });
});

describe('runCli gen', () => {
  it('prints generated playwright code to stdout when --out is absent', async () => {
    const dir = await tmp();
    try {
      const p = await writeSuite(dir, 'suite.json', suite);
      const { io, out } = makeIO();
      const code = await runCli(['gen', p, '--framework', 'playwright'], io);
      expect(code).toBe(0);
      const stdout = out.join('');
      expect(stdout).toContain("test('login flow'");
      expect(stdout).toContain('await page.goto');
      expect(stdout).toContain("await page.fill('#user', 'alice')");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('writes to --out when given and prints a "wrote <path>" confirmation', async () => {
    const dir = await tmp();
    try {
      const p = await writeSuite(dir, 'suite.json', suite);
      const outFile = join(dir, 'out.spec.ts');
      const { io, out } = makeIO();
      const code = await runCli(['gen', p, '--framework', 'playwright', '--out', outFile], io);
      expect(code).toBe(0);
      expect(out.join('')).toContain(`wrote ${outFile}`);
      const written = await readFile(outFile, 'utf8');
      expect(written).toContain("test('login flow'");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects missing --framework with exit 1', async () => {
    const dir = await tmp();
    try {
      const p = await writeSuite(dir, 'suite.json', suite);
      const { io, err } = makeIO();
      const code = await runCli(['gen', p], io);
      expect(code).toBe(1);
      expect(err.join('')).toContain('--framework is required');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects an unknown framework with exit 1', async () => {
    const dir = await tmp();
    try {
      const p = await writeSuite(dir, 'suite.json', suite);
      const { io, err } = makeIO();
      const code = await runCli(['gen', p, '--framework', 'selenium'], io);
      expect(code).toBe(1);
      expect(err.join('')).toContain('unknown framework');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects missing positional with exit 2', async () => {
    const { io, err } = makeIO();
    const code = await runCli(['gen', '--framework', 'playwright'], io);
    expect(code).toBe(2);
    expect(err.join('')).toContain('missing <suite.json>');
  });

  it('rejects malformed suite JSON with exit 1', async () => {
    const dir = await tmp();
    try {
      const p = join(dir, 'bad.json');
      await writeFile(p, '{"not":"a suite"}', 'utf8');
      const { io, err } = makeIO();
      const code = await runCli(['gen', p, '--framework', 'playwright'], io);
      expect(code).toBe(1);
      expect(err.join('')).toContain('Invalid test suite');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('runCli export', () => {
  it('writes a spec file into --out directory and returns 0', async () => {
    const dir = await tmp();
    try {
      const p = await writeSuite(dir, 'suite.json', suite);
      const outDir = join(dir, 'out');
      const { io, out } = makeIO();
      const code = await runCli(
        ['export', p, '--framework', 'playwright', '--out', outDir],
        io,
      );
      expect(code).toBe(0);
      const expected = join(outDir, 'login_flow.spec.ts');
      await stat(expected);
      expect(out.join('')).toContain(`wrote ${expected}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('injects settings from --settings into the playwright spec', async () => {
    const dir = await tmp();
    try {
      const p = await writeSuite(dir, 'suite.json', suite);
      const settingsPath = join(dir, 'settings.json');
      await writeFile(
        settingsPath,
        JSON.stringify({ userAgent: 'BatUA/1.0', viewport: { width: 800, height: 600 } }),
        'utf8',
      );
      const outDir = join(dir, 'out');
      const { io } = makeIO();
      const code = await runCli(
        [
          'export', p,
          '--framework', 'playwright',
          '--out', outDir,
          '--settings', settingsPath,
        ],
        io,
      );
      expect(code).toBe(0);
      const spec = await readFile(join(outDir, 'login_flow.spec.ts'), 'utf8');
      expect(spec).toContain('test.use(');
      expect(spec).toContain('BatUA/1.0');
      expect(spec).toContain('"width": 800');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects invalid settings with a clear error', async () => {
    const dir = await tmp();
    try {
      const p = await writeSuite(dir, 'suite.json', suite);
      const bad = join(dir, 'settings.json');
      await writeFile(bad, JSON.stringify({ geo: { latitude: 999, longitude: 0 } }), 'utf8');
      const { io, err } = makeIO();
      const code = await runCli(
        ['export', p, '--framework', 'playwright', '--out', join(dir, 'out'), '--settings', bad],
        io,
      );
      expect(code).toBe(1);
      expect(err.join('')).toContain('geo.latitude');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('requires --out', async () => {
    const dir = await tmp();
    try {
      const p = await writeSuite(dir, 'suite.json', suite);
      const { io, err } = makeIO();
      const code = await runCli(['export', p, '--framework', 'playwright'], io);
      expect(code).toBe(2);
      expect(err.join('')).toContain('--out');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('runCli bundle', () => {
  it('bundles multiple suites into a runnable directory', async () => {
    const dir = await tmp();
    try {
      const a = await writeSuite(dir, 'a.json', suite);
      const b = await writeSuite(dir, 'b.json', suite2);
      const outDir = join(dir, 'out');
      const { io, out } = makeIO();
      const code = await runCli(
        [
          'bundle', a, b,
          '--framework', 'playwright',
          '--out', outDir,
          '--package-name', 'my-suite',
          '--version', '9.9.9',
        ],
        io,
      );
      expect(code).toBe(0);
      const stdout = out.join('');
      expect(stdout).toContain('bundled 2 suite(s)');
      await stat(join(outDir, 'tests', 'login_flow.spec.ts'));
      await stat(join(outDir, 'tests', 'logout_flow.spec.ts'));
      await stat(join(outDir, 'playwright.config.ts'));
      const pkg = JSON.parse(await readFile(join(outDir, 'package.json'), 'utf8'));
      expect(pkg.name).toBe('my-suite');
      expect(pkg.version).toBe('9.9.9');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects bundle with no positional inputs', async () => {
    const { io, err } = makeIO();
    const code = await runCli(['bundle', '--framework', 'playwright', '--out', '/tmp/x'], io);
    expect(code).toBe(2);
    expect(err.join('')).toContain('at least one');
  });

  it('writes a .zip when --zip is supplied', async () => {
    const dir = await tmp();
    try {
      const a = await writeSuite(dir, 'a.json', suite);
      const outDir = join(dir, 'out');
      const zipPath = join(dir, 'bundle.zip');
      const { io, out } = makeIO();
      const code = await runCli(
        [
          'bundle', a,
          '--framework', 'playwright',
          '--out', outDir,
          '--zip', zipPath,
        ],
        io,
      );
      expect(code).toBe(0);
      const stdout = out.join('');
      expect(stdout).toContain('bundled 1 suite(s)');
      expect(stdout).toContain('zipped');
      expect(stdout).toContain(zipPath);
      const st = await stat(zipPath);
      expect(st.size).toBeGreaterThan(0);
      // Bundle directory still present on disk alongside the zip.
      await stat(join(outDir, 'tests', 'login_flow.spec.ts'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('runCli run', () => {
  it('invokes the injected runSuite, streams stdout/stderr, exits 0 on pass', async () => {
    const dir = await tmp();
    try {
      const p = await writeSuite(dir, 'suite.json', suite);
      const { io, out, err } = makeIO();
      const calls: Array<{ name: string; framework: string; cwd?: string; timeoutMs?: number; command?: string }> = [];
      io.runSuite = async (s, fw, opts) => {
        calls.push({
          name: s.name,
          framework: fw,
          cwd: opts.cwd,
          timeoutMs: opts.timeoutMs,
          command: opts.command,
        });
        opts.onStdout?.('hello\n');
        opts.onStderr?.('warn\n');
        return { exitCode: 0, stdout: 'hello\n', stderr: 'warn\n', passed: true, durationMs: 42 };
      };
      const code = await runCli(['run', p, '--framework', 'playwright'], io);
      expect(code).toBe(0);
      expect(calls).toEqual([{ name: 'login flow', framework: 'playwright', cwd: undefined, timeoutMs: undefined, command: undefined }]);
      const stdout = out.join('');
      expect(stdout).toContain('hello');
      expect(stdout).toContain('PASS login flow');
      expect(stdout).toContain('exit 0');
      expect(err.join('')).toContain('warn');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('forwards --cwd, --timeout, --command into RunOptions', async () => {
    const dir = await tmp();
    try {
      const p = await writeSuite(dir, 'suite.json', suite);
      const { io } = makeIO();
      let captured: { cwd?: string; timeoutMs?: number; command?: string } | undefined;
      io.runSuite = async (_s, _fw, opts) => {
        captured = { cwd: opts.cwd, timeoutMs: opts.timeoutMs, command: opts.command };
        return { exitCode: 0, stdout: '', stderr: '', passed: true, durationMs: 1 };
      };
      const code = await runCli(
        ['run', p, '--framework', 'playwright', '--cwd', '/work', '--timeout', '5000', '--command', 'mybin'],
        io,
      );
      expect(code).toBe(0);
      expect(captured).toEqual({ cwd: '/work', timeoutMs: 5000, command: 'mybin' });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('returns exit 1 with a FAIL banner when runner fails', async () => {
    const dir = await tmp();
    try {
      const p = await writeSuite(dir, 'suite.json', suite);
      const { io, out } = makeIO();
      io.runSuite = async () => ({ exitCode: 2, stdout: '', stderr: 'boom', passed: false, durationMs: 9 });
      const code = await runCli(['run', p, '--framework', 'playwright'], io);
      expect(code).toBe(1);
      expect(out.join('')).toContain('FAIL login flow');
      expect(out.join('')).toContain('exit 2');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects --timeout that is not a number with exit 1', async () => {
    const dir = await tmp();
    try {
      const p = await writeSuite(dir, 'suite.json', suite);
      const { io, err } = makeIO();
      io.runSuite = async () => ({ exitCode: 0, stdout: '', stderr: '', passed: true, durationMs: 0 });
      const code = await runCli(['run', p, '--framework', 'playwright', '--timeout', 'abc'], io);
      expect(code).toBe(1);
      expect(err.join('')).toContain('--timeout');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects missing positional with exit 2', async () => {
    const { io, err } = makeIO();
    const code = await runCli(['run', '--framework', 'playwright'], io);
    expect(code).toBe(2);
    expect(err.join('')).toContain('missing <suite.json>');
  });
});

const sampleReport = {
  stats: { duration: 1234 },
  suites: [
    {
      title: 'login.spec.ts',
      file: 'login.spec.ts',
      specs: [
        {
          title: 'login flow',
          file: 'login.spec.ts',
          tests: [
            {
              results: [
                {
                  status: 'passed',
                  duration: 1200,
                  steps: [
                    { title: 'Before Hooks', duration: 10 },
                    { title: 'page.goto(https://example.com)', duration: 50 },
                    { title: 'page.fill(#user)', duration: 20 },
                    { title: 'page.click([data-testid="submit"])', duration: 30 },
                    { title: 'After Hooks', duration: 2 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

const failingReport = {
  stats: { duration: 200 },
  suites: [
    {
      title: 'login.spec.ts',
      specs: [
        {
          title: 'login flow',
          tests: [
            {
              results: [
                {
                  status: 'failed',
                  duration: 200,
                  error: { message: 'locator not found' },
                  steps: [
                    { title: 'page.goto(https://example.com)', duration: 50 },
                    { title: 'page.fill(#user)', duration: 20, error: { message: 'locator not found' } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe('runCli report', () => {
  it('prints a per-step pass/fail table for a passing suite, exits 0', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(sampleReport), 'utf8');
      const { io, out } = makeIO();
      const code = await runCli(['report', sp, rp], io);
      expect(code).toBe(0);
      const stdout = out.join('');
      expect(stdout).toContain('login flow: passed');
      expect(stdout).toContain('[OK] 1. navigate');
      expect(stdout).toContain('[OK] 2. fill');
      expect(stdout).toContain('[OK] 3. click');
      expect(stdout).toContain('1 passed, 0 failed');
      expect(stdout).toContain('1234ms total');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('marks failed steps with [XX] and trailing not-run steps with [--], exits 1', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(failingReport), 'utf8');
      const { io, out } = makeIO();
      const code = await runCli(['report', sp, rp], io);
      expect(code).toBe(1);
      const stdout = out.join('');
      expect(stdout).toContain('login flow: failed');
      expect(stdout).toContain('[OK] 1. navigate');
      expect(stdout).toContain('[XX] 2. fill');
      expect(stdout).toContain('[--] 3. click');
      expect(stdout).toContain('locator not found');
      expect(stdout).toContain('not run');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects missing <suite.json> and missing <report.json> with exit 2', async () => {
    const { io: io1, err: err1 } = makeIO();
    expect(await runCli(['report'], io1)).toBe(2);
    expect(err1.join('')).toContain('missing <suite.json>');

    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const { io: io2, err: err2 } = makeIO();
      expect(await runCli(['report', sp], io2)).toBe(2);
      expect(err2.join('')).toContain('missing <report.json>');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('handles an empty/malformed report gracefully', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, 'not json', 'utf8');
      const { io, out } = makeIO();
      const code = await runCli(['report', sp, rp], io);
      expect(code).toBe(0);
      expect(out.join('')).toContain('(no specs in report)');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

const multiSpecReport = {
  stats: { duration: 500 },
  suites: [
    {
      title: 'login.spec.ts',
      specs: [
        {
          title: 'first spec',
          tests: [
            {
              results: [
                {
                  status: 'failed',
                  duration: 100,
                  error: { message: 'boom in first' },
                  steps: [
                    { title: 'page.goto(https://example.com)', duration: 10, error: { message: 'boom in first' } },
                  ],
                },
              ],
            },
          ],
        },
        {
          title: 'login flow',
          tests: [
            {
              results: [
                {
                  status: 'passed',
                  duration: 400,
                  steps: [
                    { title: 'page.goto(https://example.com)', duration: 50 },
                    { title: 'page.fill(#user)', duration: 20 },
                    { title: 'page.click([data-testid="submit"])', duration: 30 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe('runCli report --spec', () => {
  it('renders the Nth spec (1-based) instead of the first', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(multiSpecReport), 'utf8');
      const { io, out } = makeIO();
      const code = await runCli(['report', sp, rp, '--spec', '2'], io);
      expect(code).toBe(0);
      const stdout = out.join('');
      expect(stdout).toContain('login flow: passed');
      expect(stdout).toContain('[OK] 1. navigate');
      expect(stdout).toContain('[OK] 2. fill');
      expect(stdout).toContain('[OK] 3. click');
      expect(stdout).not.toContain('first spec');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('defaults to spec 1 when --spec is omitted', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(multiSpecReport), 'utf8');
      const { io, out } = makeIO();
      const code = await runCli(['report', sp, rp], io);
      expect(code).toBe(1);
      const stdout = out.join('');
      expect(stdout).toContain('first spec: failed');
      expect(stdout).toContain('boom in first');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('exits 2 with a clear message when --spec is out of range', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(multiSpecReport), 'utf8');
      const { io, err } = makeIO();
      const code = await runCli(['report', sp, rp, '--spec', '5'], io);
      expect(code).toBe(2);
      expect(err.join('')).toMatch(/--spec 5 out of range.*2 specs/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('exits 1 when --spec is not a positive integer', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(multiSpecReport), 'utf8');
      const { io, err } = makeIO();
      const code = await runCli(['report', sp, rp, '--spec', '0'], io);
      expect(code).toBe(1);
      expect(err.join('')).toContain('--spec must be a positive integer');

      const { io: io2, err: err2 } = makeIO();
      const code2 = await runCli(['report', sp, rp, '--spec', 'abc'], io2);
      expect(code2).toBe(1);
      expect(err2.join('')).toContain('--spec must be a positive integer');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('runCli report --json', () => {
  it('emits machine-readable correlated pairs and exits 0 on pass', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(sampleReport), 'utf8');
      const { io, out } = makeIO();
      const code = await runCli(['report', sp, rp, '--json'], io);
      expect(code).toBe(0);
      const parsed = JSON.parse(out.join(''));
      expect(parsed.suite).toBe('login flow');
      expect(parsed.spec.title).toBe('login flow');
      expect(parsed.spec.status).toBe('passed');
      expect(parsed.totalSpecs).toBe(1);
      expect(parsed.summary).toEqual({ passed: 1, failed: 0, skipped: 0, totalDurationMs: 1234 });
      expect(parsed.pairs).toHaveLength(3);
      expect(parsed.pairs[0].step.type).toBe('navigate');
      expect(parsed.pairs[0].label).toContain('navigate');
      expect(parsed.pairs[0].result.status).toBe('passed');
      expect(parsed.pairs[2].step.type).toBe('click');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('preserves not-run steps as null results in the JSON output and exits 1 on failed spec', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(failingReport), 'utf8');
      const { io, out } = makeIO();
      const code = await runCli(['report', sp, rp, '--json'], io);
      expect(code).toBe(1);
      const parsed = JSON.parse(out.join(''));
      expect(parsed.spec.status).toBe('failed');
      expect(parsed.pairs[0].result.status).toBe('passed');
      expect(parsed.pairs[1].result.status).toBe('failed');
      expect(parsed.pairs[1].result.error).toBe('locator not found');
      expect(parsed.pairs[2].result).toBe(null);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('combines --spec and --json to render a specific spec as JSON', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(multiSpecReport), 'utf8');
      const { io, out } = makeIO();
      const code = await runCli(['report', sp, rp, '--spec', '2', '--json'], io);
      expect(code).toBe(0);
      const parsed = JSON.parse(out.join(''));
      expect(parsed.spec.index).toBe(1);
      expect(parsed.spec.title).toBe('login flow');
      expect(parsed.spec.status).toBe('passed');
      expect(parsed.totalSpecs).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('emits an empty-but-valid JSON envelope when the report has no specs', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, 'not json', 'utf8');
      const { io, out } = makeIO();
      const code = await runCli(['report', sp, rp, '--json'], io);
      expect(code).toBe(0);
      const parsed = JSON.parse(out.join(''));
      expect(parsed).toEqual({ suite: 'login flow', spec: null, totalSpecs: 0, pairs: [] });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('runCli report --all', () => {
  it('renders every spec in order with separators and exits 1 if any failed', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(multiSpecReport), 'utf8');
      const { io, out } = makeIO();
      const code = await runCli(['report', sp, rp, '--all'], io);
      expect(code).toBe(1);
      const stdout = out.join('');
      // Both specs must appear
      expect(stdout).toContain('first spec: failed');
      expect(stdout).toContain('login flow: passed');
      // Section headers call out the 1/2 position
      expect(stdout).toContain('--- spec 1/2 ---');
      expect(stdout).toContain('--- spec 2/2 ---');
      // Roll-up summary printed exactly once at the end
      expect(stdout.match(/passed,.*failed,.*skipped/g)?.length).toBe(1);
      // Order preserved (first spec before second)
      expect(stdout.indexOf('first spec')).toBeLessThan(stdout.indexOf('login flow'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('exits 0 when every spec passed', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(sampleReport), 'utf8');
      const { io, out } = makeIO();
      const code = await runCli(['report', sp, rp, '--all'], io);
      expect(code).toBe(0);
      expect(out.join('')).toContain('login flow: passed');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects --spec and --all together with exit 1', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(multiSpecReport), 'utf8');
      const { io, err } = makeIO();
      const code = await runCli(['report', sp, rp, '--spec', '1', '--all'], io);
      expect(code).toBe(1);
      expect(err.join('')).toContain('mutually exclusive');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('emits a specs[] array when combined with --json', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(multiSpecReport), 'utf8');
      const { io, out } = makeIO();
      const code = await runCli(['report', sp, rp, '--all', '--json'], io);
      expect(code).toBe(1);
      const parsed = JSON.parse(out.join(''));
      expect(parsed.suite).toBe('login flow');
      expect(parsed.totalSpecs).toBe(2);
      expect(parsed.specs).toHaveLength(2);
      expect(parsed.specs[0].spec.index).toBe(0);
      expect(parsed.specs[0].spec.status).toBe('failed');
      expect(parsed.specs[1].spec.index).toBe(1);
      expect(parsed.specs[1].spec.status).toBe('passed');
      // Each spec envelope still carries its own pairs
      expect(parsed.specs[1].pairs).toHaveLength(3);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('emits a specs[]-shaped envelope even when the report is empty', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, 'not json', 'utf8');
      const { io, out } = makeIO();
      const code = await runCli(['report', sp, rp, '--all', '--json'], io);
      expect(code).toBe(0);
      const parsed = JSON.parse(out.join(''));
      expect(parsed).toEqual({ suite: 'login flow', totalSpecs: 0, specs: [] });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

const triReport = {
  stats: { duration: 600 },
  suites: [
    {
      title: 'mixed.spec.ts',
      specs: [
        {
          title: 'first spec',
          tests: [{ results: [{ status: 'failed', duration: 100, error: { message: 'boom' }, steps: [] }] }],
        },
        {
          title: 'second spec',
          tests: [{ results: [{ status: 'passed', duration: 200, steps: [] }] }],
        },
        {
          title: 'third spec',
          tests: [{ results: [{ status: 'skipped', duration: 0, steps: [] }] }],
        },
      ],
    },
  ],
};

describe('runCli report --all --filter', () => {
  it('renders only specs whose status matches a single --filter value', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(triReport), 'utf8');
      const { io, out } = makeIO();
      const code = await runCli(['report', sp, rp, '--all', '--filter', 'passed'], io);
      // exit code follows the FULL report (1 because there's a failing spec),
      // not the filtered subset — filter is a display concern only.
      expect(code).toBe(1);
      const stdout = out.join('');
      expect(stdout).toContain('second spec: passed');
      expect(stdout).not.toContain('first spec');
      expect(stdout).not.toContain('third spec');
      // Section header keeps the spec's ORIGINAL position in the full report
      // so users can correlate back ("--- spec 2/3 ---", not "--- spec 1/1 ---").
      expect(stdout).toContain('--- spec 2/3 ---');
      // Roll-up footer always reflects the full report
      expect(stdout).toContain('1 passed, 1 failed, 1 skipped');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('accepts a comma-separated list of statuses', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(triReport), 'utf8');
      const { io, out } = makeIO();
      const code = await runCli(
        ['report', sp, rp, '--all', '--filter', 'failed,skipped'],
        io,
      );
      expect(code).toBe(1);
      const stdout = out.join('');
      expect(stdout).toContain('first spec: failed');
      expect(stdout).toContain('third spec: skipped');
      expect(stdout).not.toContain('second spec');
      expect(stdout).toContain('--- spec 1/3 ---');
      expect(stdout).toContain('--- spec 3/3 ---');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('prints a "no specs match" message when the filter eliminates everything', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(sampleReport), 'utf8');
      const { io, out } = makeIO();
      const code = await runCli(
        ['report', sp, rp, '--all', '--filter', 'failed'],
        io,
      );
      // sampleReport has only passed specs → exit 0; filter empty result is not an error
      expect(code).toBe(0);
      const stdout = out.join('');
      expect(stdout).toContain('(no specs match --filter failed)');
      // Footer still prints
      expect(stdout).toMatch(/passed,.*failed,.*skipped/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects --filter without --all (exit 1)', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(triReport), 'utf8');
      const { io, err } = makeIO();
      const code = await runCli(['report', sp, rp, '--filter', 'passed'], io);
      expect(code).toBe(1);
      expect(err.join('')).toContain('--filter requires --all');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects unknown filter values with exit 1 and a clear message', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(triReport), 'utf8');
      const { io, err } = makeIO();
      const code = await runCli(
        ['report', sp, rp, '--all', '--filter', 'broken'],
        io,
      );
      expect(code).toBe(1);
      const stderr = err.join('');
      expect(stderr).toContain('unknown status');
      expect(stderr).toContain('broken');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('emits a filtered specs[] in --json mode while keeping the full-report summary intact', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(triReport), 'utf8');
      const { io, out } = makeIO();
      const code = await runCli(
        ['report', sp, rp, '--all', '--filter', 'failed', '--json'],
        io,
      );
      expect(code).toBe(1);
      const parsed = JSON.parse(out.join(''));
      expect(parsed.totalSpecs).toBe(3);
      // Summary is the FULL report's tally — filter doesn't lie about totals
      expect(parsed.summary).toEqual({
        passed: 1,
        failed: 1,
        skipped: 1,
        totalDurationMs: 600,
      });
      // Filter echoed back into the envelope
      expect(parsed.filter).toEqual(['failed']);
      // Only the failed spec appears
      expect(parsed.specs).toHaveLength(1);
      expect(parsed.specs[0].spec.index).toBe(0);
      expect(parsed.specs[0].spec.status).toBe('failed');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('deduplicates repeated filter values silently', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(triReport), 'utf8');
      const { io, out } = makeIO();
      const code = await runCli(
        ['report', sp, rp, '--all', '--filter', 'passed,passed,passed', '--json'],
        io,
      );
      expect(code).toBe(1);
      const parsed = JSON.parse(out.join(''));
      expect(parsed.filter).toEqual(['passed']);
      expect(parsed.specs).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('runCli report --all --filter --invert', () => {
  it('shows specs that do NOT match --filter (exclude-passed → failed + skipped)', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(triReport), 'utf8');
      const { io, out } = makeIO();
      const code = await runCli(
        ['report', sp, rp, '--all', '--filter', 'passed', '--invert'],
        io,
      );
      // Exit code still follows the FULL report (failure exists) — invert is a
      // display concern and does not change the roll-up verdict.
      expect(code).toBe(1);
      const stdout = out.join('');
      expect(stdout).toContain('first spec: failed');
      expect(stdout).toContain('third spec: skipped');
      expect(stdout).not.toContain('second spec');
      // Original positions preserved in section headers
      expect(stdout).toContain('--- spec 1/3 ---');
      expect(stdout).toContain('--- spec 3/3 ---');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('emits an inverted specs[] in --json mode and echoes invert: true', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(triReport), 'utf8');
      const { io, out } = makeIO();
      const code = await runCli(
        ['report', sp, rp, '--all', '--filter', 'passed', '--invert', '--json'],
        io,
      );
      expect(code).toBe(1);
      const parsed = JSON.parse(out.join(''));
      expect(parsed.filter).toEqual(['passed']);
      expect(parsed.invert).toBe(true);
      // All non-passed specs: indices 0 (failed) and 2 (skipped)
      expect(parsed.specs.map((s: { spec: { index: number } }) => s.spec.index)).toEqual([0, 2]);
      // Summary still reflects the FULL report
      expect(parsed.summary).toEqual({
        passed: 1,
        failed: 1,
        skipped: 1,
        totalDurationMs: 600,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('omits invert from --json when not passed (byte-stable)', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(triReport), 'utf8');
      const { io, out } = makeIO();
      const code = await runCli(
        ['report', sp, rp, '--all', '--filter', 'passed', '--json'],
        io,
      );
      expect(code).toBe(1);
      const parsed = JSON.parse(out.join(''));
      expect('invert' in parsed).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('prints "(no specs match ... --invert)" when invert eliminates everything', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      // sampleReport has only passed specs; invert(passed) matches nothing.
      await writeFile(rp, JSON.stringify(sampleReport), 'utf8');
      const { io, out } = makeIO();
      const code = await runCli(
        ['report', sp, rp, '--all', '--filter', 'passed', '--invert'],
        io,
      );
      // sampleReport has zero failures → exit 0 even though invert is empty
      expect(code).toBe(0);
      const stdout = out.join('');
      expect(stdout).toContain('(no specs match --filter passed --invert)');
      // Footer still prints
      expect(stdout).toMatch(/passed,.*failed,.*skipped/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('composes with --sort and --top (filter→invert→sort→top, same order as --filter)', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(triReport), 'utf8');
      const { io, out } = makeIO();
      const code = await runCli(
        [
          'report', sp, rp,
          '--all',
          '--filter', 'passed',
          '--invert',
          '--sort', 'duration',
          '--top', '1',
        ],
        io,
      );
      expect(code).toBe(1);
      const stdout = out.join('');
      // invert(passed) → [first(failed, 100ms), third(skipped, 0ms)];
      // sort duration desc → [first, third]; top 1 → [first]
      expect(stdout).toContain('first spec');
      expect(stdout).not.toContain('second spec');
      expect(stdout).not.toContain('third spec');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects --invert without --filter (exit 1)', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(triReport), 'utf8');
      const { io, err } = makeIO();
      const code = await runCli(['report', sp, rp, '--all', '--invert'], io);
      expect(code).toBe(1);
      expect(err.join('')).toContain('--invert requires --filter');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects --invert without --all (exit 1)', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(triReport), 'utf8');
      const { io, err } = makeIO();
      const code = await runCli(
        ['report', sp, rp, '--filter', 'passed', '--invert'],
        io,
      );
      expect(code).toBe(1);
      // --filter without --all is caught first — that's the correct signal to
      // the user: fix --all before layering invert on top. Either error wording
      // acceptable as long as exit code is 1.
      const stderr = err.join('');
      expect(stderr).toMatch(/requires --all/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('invert over a multi-status filter excludes all listed statuses', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(triReport), 'utf8');
      const { io, out } = makeIO();
      // filter passed+failed, invert → only skipped remains
      const code = await runCli(
        ['report', sp, rp, '--all', '--filter', 'passed,failed', '--invert', '--json'],
        io,
      );
      expect(code).toBe(1);
      const parsed = JSON.parse(out.join(''));
      expect(parsed.specs.map((s: { spec: { index: number } }) => s.spec.index)).toEqual([2]);
      expect(parsed.specs[0].spec.status).toBe('skipped');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('runCli report --all --sort', () => {
  it('sorts specs by duration descending (slowest first)', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(triReport), 'utf8');
      const { io, out } = makeIO();
      const code = await runCli(
        ['report', sp, rp, '--all', '--sort', 'duration'],
        io,
      );
      // Full report has a failure → exit 1
      expect(code).toBe(1);
      const stdout = out.join('');
      // Sort order in output: 200ms (passed) > 100ms (failed) > 0ms (skipped)
      const i2 = stdout.indexOf('second spec');
      const i1 = stdout.indexOf('first spec');
      const i3 = stdout.indexOf('third spec');
      expect(i2).toBeGreaterThan(0);
      expect(i1).toBeGreaterThan(i2);
      expect(i3).toBeGreaterThan(i1);
      // Original positions preserved in --- spec N/total --- headers
      expect(stdout).toContain('--- spec 2/3 ---');
      expect(stdout).toContain('--- spec 1/3 ---');
      expect(stdout).toContain('--- spec 3/3 ---');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('supports duration-asc to put the fastest spec first', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(triReport), 'utf8');
      const { io, out } = makeIO();
      const code = await runCli(
        ['report', sp, rp, '--all', '--sort', 'duration-asc'],
        io,
      );
      expect(code).toBe(1);
      const stdout = out.join('');
      // Ascending: 0ms (skipped) < 100ms (failed) < 200ms (passed)
      const i3 = stdout.indexOf('third spec');
      const i1 = stdout.indexOf('first spec');
      const i2 = stdout.indexOf('second spec');
      expect(i3).toBeGreaterThan(0);
      expect(i1).toBeGreaterThan(i3);
      expect(i2).toBeGreaterThan(i1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('combines --filter and --sort: filter first, then sort the survivors', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(triReport), 'utf8');
      const { io, out } = makeIO();
      const code = await runCli(
        ['report', sp, rp, '--all', '--filter', 'failed,passed', '--sort', 'duration'],
        io,
      );
      expect(code).toBe(1);
      const stdout = out.join('');
      // Filter drops "third spec" (skipped); sort puts second (200ms) before first (100ms)
      expect(stdout).not.toContain('third spec');
      const i2 = stdout.indexOf('second spec');
      const i1 = stdout.indexOf('first spec');
      expect(i2).toBeGreaterThan(0);
      expect(i1).toBeGreaterThan(i2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('emits sorted specs[] in --json mode and echoes the sort key back', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(triReport), 'utf8');
      const { io, out } = makeIO();
      const code = await runCli(
        ['report', sp, rp, '--all', '--sort', 'duration', '--json'],
        io,
      );
      expect(code).toBe(1);
      const parsed = JSON.parse(out.join(''));
      // Summary still reflects the FULL report
      expect(parsed.totalSpecs).toBe(3);
      expect(parsed.summary.passed).toBe(1);
      expect(parsed.sort).toBe('duration');
      // Sorted: indices 1 (200ms), 0 (100ms), 2 (0ms)
      expect(parsed.specs.map((s: { spec: { index: number } }) => s.spec.index)).toEqual([1, 0, 2]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects --sort without --all (exit 1)', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(triReport), 'utf8');
      const { io, err } = makeIO();
      const code = await runCli(['report', sp, rp, '--sort', 'duration'], io);
      expect(code).toBe(1);
      expect(err.join('')).toContain('--sort requires --all');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects unknown sort keys with exit 1 and a clear message', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(triReport), 'utf8');
      const { io, err } = makeIO();
      const code = await runCli(
        ['report', sp, rp, '--all', '--sort', 'flaky'],
        io,
      );
      expect(code).toBe(1);
      const stderr = err.join('');
      expect(stderr).toContain('unknown key');
      expect(stderr).toContain('flaky');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('uses original spec index as a stable tie-breaker for equal durations', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      // Three specs all 50ms — sort must NOT shuffle them; original order preserved
      const tiedReport = {
        stats: { duration: 150 },
        suites: [
          {
            title: 'tied.spec.ts',
            specs: [
              { title: 'alpha', tests: [{ results: [{ status: 'passed', duration: 50, steps: [] }] }] },
              { title: 'beta', tests: [{ results: [{ status: 'passed', duration: 50, steps: [] }] }] },
              { title: 'gamma', tests: [{ results: [{ status: 'passed', duration: 50, steps: [] }] }] },
            ],
          },
        ],
      };
      await writeFile(rp, JSON.stringify(tiedReport), 'utf8');
      const { io, out } = makeIO();
      const code = await runCli(
        ['report', sp, rp, '--all', '--sort', 'duration', '--json'],
        io,
      );
      expect(code).toBe(0);
      const parsed = JSON.parse(out.join(''));
      expect(parsed.specs.map((s: { spec: { index: number } }) => s.spec.index)).toEqual([0, 1, 2]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('runCli report --all --top', () => {
  it('shows only the top-N specs after --sort (N slowest workflow)', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(triReport), 'utf8');
      const { io, out } = makeIO();
      const code = await runCli(
        ['report', sp, rp, '--all', '--sort', 'duration', '--top', '2'],
        io,
      );
      // exit code follows the FULL report, not the top-N slice
      expect(code).toBe(1);
      const stdout = out.join('');
      // Sorted order is second(200) > first(100) > third(0); --top 2 keeps first two.
      expect(stdout).toContain('second spec');
      expect(stdout).toContain('first spec');
      expect(stdout).not.toContain('third spec');
      // --- spec N/total --- headers keep ORIGINAL positions in the full report
      expect(stdout).toContain('--- spec 2/3 ---');
      expect(stdout).toContain('--- spec 1/3 ---');
      // Footer reflects the FULL report, not the top-N slice
      expect(stdout).toContain('1 passed, 1 failed, 1 skipped');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('without --sort, --top takes the first N in original source order', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(triReport), 'utf8');
      const { io, out } = makeIO();
      const code = await runCli(['report', sp, rp, '--all', '--top', '1'], io);
      expect(code).toBe(1);
      const stdout = out.join('');
      // First spec in source order is the failed one (index 0)
      expect(stdout).toContain('first spec');
      expect(stdout).not.toContain('second spec');
      expect(stdout).not.toContain('third spec');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('composes with --filter and --sort: filter → sort → top, in that order', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(triReport), 'utf8');
      const { io, out } = makeIO();
      const code = await runCli(
        [
          'report', sp, rp,
          '--all',
          '--filter', 'failed,passed',
          '--sort', 'duration',
          '--top', '1',
        ],
        io,
      );
      expect(code).toBe(1);
      const stdout = out.join('');
      // filter drops "third spec" (skipped); sort puts second(200) > first(100);
      // top 1 keeps only "second spec"
      expect(stdout).toContain('second spec');
      expect(stdout).not.toContain('first spec');
      expect(stdout).not.toContain('third spec');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('tolerates --top larger than available specs (shows them all)', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(triReport), 'utf8');
      const { io, out } = makeIO();
      const code = await runCli(['report', sp, rp, '--all', '--top', '99'], io);
      expect(code).toBe(1);
      const stdout = out.join('');
      expect(stdout).toContain('first spec');
      expect(stdout).toContain('second spec');
      expect(stdout).toContain('third spec');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('emits the trimmed specs[] in --json mode and echoes top back', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(triReport), 'utf8');
      const { io, out } = makeIO();
      const code = await runCli(
        ['report', sp, rp, '--all', '--sort', 'duration', '--top', '2', '--json'],
        io,
      );
      expect(code).toBe(1);
      const parsed = JSON.parse(out.join(''));
      // Summary still reflects the FULL report
      expect(parsed.totalSpecs).toBe(3);
      expect(parsed.summary.passed).toBe(1);
      expect(parsed.summary.failed).toBe(1);
      expect(parsed.summary.skipped).toBe(1);
      // Sort echoed, top echoed
      expect(parsed.sort).toBe('duration');
      expect(parsed.top).toBe(2);
      // specs[] trimmed to the top 2: indices 1 (200ms) then 0 (100ms)
      expect(parsed.specs.map((s: { spec: { index: number } }) => s.spec.index)).toEqual([1, 0]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('omits the top field from --json when --top is not passed (byte-stable)', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(triReport), 'utf8');
      const { io, out } = makeIO();
      const code = await runCli(['report', sp, rp, '--all', '--json'], io);
      expect(code).toBe(1);
      const parsed = JSON.parse(out.join(''));
      expect('top' in parsed).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects --top without --all (exit 1)', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(triReport), 'utf8');
      const { io, err } = makeIO();
      const code = await runCli(['report', sp, rp, '--top', '2'], io);
      expect(code).toBe(1);
      expect(err.join('')).toContain('--top requires --all');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects --top 0 and negative values with exit 1', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(triReport), 'utf8');
      for (const bad of ['0', '-1', '2.5', 'abc']) {
        const { io, err } = makeIO();
        const code = await runCli(
          ['report', sp, rp, '--all', '--top', bad],
          io,
        );
        expect(code).toBe(1);
        expect(err.join('')).toContain('--top must be a positive integer');
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('runCli report --all --summary-only', () => {
  it('prints only the footer summary line, no per-spec bodies', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(triReport), 'utf8');
      const { io, out } = makeIO();
      const code = await runCli(['report', sp, rp, '--all', '--summary-only'], io);
      expect(code).toBe(1);
      const stdout = out.join('');
      expect(stdout).toContain('1 passed, 1 failed, 1 skipped');
      // No per-spec bodies, no section headers
      expect(stdout).not.toContain('first spec');
      expect(stdout).not.toContain('second spec');
      expect(stdout).not.toContain('third spec');
      expect(stdout).not.toContain('--- spec');
      expect(stdout).not.toContain('[OK]');
      expect(stdout).not.toContain('[XX]');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('--summary-only --json emits empty specs[] and a summaryOnly: true marker', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(triReport), 'utf8');
      const { io, out } = makeIO();
      const code = await runCli(
        ['report', sp, rp, '--all', '--summary-only', '--json'],
        io,
      );
      expect(code).toBe(1);
      const parsed = JSON.parse(out.join(''));
      expect(parsed.suite).toBe('login flow');
      expect(parsed.totalSpecs).toBe(3);
      expect(parsed.summary).toEqual({
        passed: 1,
        failed: 1,
        skipped: 1,
        totalDurationMs: 600,
      });
      expect(parsed.specs).toEqual([]);
      expect(parsed.summaryOnly).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('omits the summaryOnly field from --json when --summary-only is not passed', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(triReport), 'utf8');
      const { io, out } = makeIO();
      await runCli(['report', sp, rp, '--all', '--json'], io);
      const parsed = JSON.parse(out.join(''));
      expect('summaryOnly' in parsed).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('combines with --filter: footer reflects FULL report, not the filtered subset', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(triReport), 'utf8');
      const { io, out } = makeIO();
      const code = await runCli(
        ['report', sp, rp, '--all', '--filter', 'failed', '--summary-only'],
        io,
      );
      expect(code).toBe(1);
      const stdout = out.join('');
      // Filter does not affect the rolled-up footer counts
      expect(stdout).toContain('1 passed, 1 failed, 1 skipped');
      expect(stdout).not.toContain('first spec');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects --summary-only without --all (exit 1)', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(triReport), 'utf8');
      const { io, err } = makeIO();
      const code = await runCli(['report', sp, rp, '--summary-only'], io);
      expect(code).toBe(1);
      expect(err.join('')).toContain('--summary-only requires --all');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('runCli report --failed-only', () => {
  it('renders only failed specs (shorthand for --all --filter failed)', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(triReport), 'utf8');
      const { io, out } = makeIO();
      const code = await runCli(['report', sp, rp, '--failed-only'], io);
      expect(code).toBe(1);
      const stdout = out.join('');
      expect(stdout).toContain('first spec: failed');
      expect(stdout).not.toContain('second spec');
      expect(stdout).not.toContain('third spec');
      // Footer reflects FULL report, not the filtered subset
      expect(stdout).toContain('1 passed, 1 failed, 1 skipped');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('--failed-only --json envelope is byte-equivalent to --all --filter failed --json', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(triReport), 'utf8');
      const a = makeIO();
      const b = makeIO();
      const codeA = await runCli(['report', sp, rp, '--failed-only', '--json'], a.io);
      const codeB = await runCli(
        ['report', sp, rp, '--all', '--filter', 'failed', '--json'],
        b.io,
      );
      expect(codeA).toBe(codeB);
      expect(a.out.join('')).toBe(b.out.join(''));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('exits 0 when no specs failed (empty-match notice still prints)', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      // sampleReport contains only passing specs
      await writeFile(rp, JSON.stringify(sampleReport), 'utf8');
      const { io, out } = makeIO();
      const code = await runCli(['report', sp, rp, '--failed-only'], io);
      expect(code).toBe(0);
      const stdout = out.join('');
      expect(stdout).toContain('(no specs match --filter failed)');
      expect(stdout).toMatch(/passed,.*failed,.*skipped/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('composes with --sort and --top', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(triReport), 'utf8');
      const { io, out } = makeIO();
      const code = await runCli(
        ['report', sp, rp, '--failed-only', '--sort', 'duration', '--top', '1'],
        io,
      );
      expect(code).toBe(1);
      const stdout = out.join('');
      expect(stdout).toContain('first spec');
      expect(stdout).not.toContain('second spec');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects --failed-only with --filter (mutually exclusive)', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(triReport), 'utf8');
      const { io, err } = makeIO();
      const code = await runCli(
        ['report', sp, rp, '--failed-only', '--filter', 'passed'],
        io,
      );
      expect(code).toBe(1);
      expect(err.join('')).toMatch(/--failed-only and --filter/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects --failed-only with --spec (mutually exclusive)', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(triReport), 'utf8');
      const { io, err } = makeIO();
      const code = await runCli(
        ['report', sp, rp, '--failed-only', '--spec', '1'],
        io,
      );
      expect(code).toBe(1);
      expect(err.join('')).toMatch(/--failed-only and --spec/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects --failed-only with --invert (mutually exclusive)', async () => {
    const dir = await tmp();
    try {
      const sp = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(triReport), 'utf8');
      const { io, err } = makeIO();
      const code = await runCli(
        ['report', sp, rp, '--failed-only', '--invert'],
        io,
      );
      expect(code).toBe(1);
      expect(err.join('')).toMatch(/--failed-only and --invert/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('runCli run --report', () => {
  it('passes --reporter=json and PLAYWRIGHT_JSON_OUTPUT_NAME through to the runner', async () => {
    const dir = await tmp();
    try {
      const p = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      let captured: { extraArgs?: string[]; env?: Record<string, string | undefined> } | undefined;
      const { io, out } = makeIO();
      io.runSuite = async (_s, _fw, opts) => {
        captured = { extraArgs: opts.extraArgs, env: opts.env };
        // Simulate playwright writing the JSON report file
        await writeFile(rp, JSON.stringify(sampleReport), 'utf8');
        return { exitCode: 0, stdout: '', stderr: '', passed: true, durationMs: 10 };
      };
      const code = await runCli(
        ['run', p, '--framework', 'playwright', '--report', rp],
        io,
      );
      expect(code).toBe(0);
      expect(captured?.extraArgs).toEqual(['--reporter=json']);
      expect(captured?.env?.PLAYWRIGHT_JSON_OUTPUT_NAME).toBe(rp);
      // After the run banner, the report content must be rendered
      const stdout = out.join('');
      expect(stdout).toContain('PASS login flow');
      expect(stdout).toContain('login flow: passed');
      expect(stdout).toContain('[OK] 1. navigate');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('resolves --report to an absolute path before passing to Playwright env', async () => {
    const dir = await tmp();
    try {
      const p = await writeSuite(dir, 'suite.json', suite);
      const relReport = 'report-rel.json';
      const absReport = join(process.cwd(), relReport);
      let captured: { env?: Record<string, string | undefined> } | undefined;
      const { io } = makeIO();
      io.runSuite = async (_s, _fw, opts) => {
        captured = { env: opts.env };
        await writeFile(absReport, JSON.stringify(sampleReport), 'utf8');
        return { exitCode: 0, stdout: '', stderr: '', passed: true, durationMs: 10 };
      };
      try {
        await runCli(['run', p, '--framework', 'playwright', '--report', relReport], io);
        expect(captured?.env?.PLAYWRIGHT_JSON_OUTPUT_NAME).toBe(absReport);
      } finally {
        await rm(absReport, { force: true });
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects --report for non-playwright frameworks with exit 1', async () => {
    const dir = await tmp();
    try {
      const p = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      const { io, err } = makeIO();
      io.runSuite = async () => ({
        exitCode: 0, stdout: '', stderr: '', passed: true, durationMs: 1,
      });
      const code = await runCli(
        ['run', p, '--framework', 'puppeteer', '--report', rp],
        io,
      );
      expect(code).toBe(1);
      expect(err.join('')).toContain('--report and --export-bugs are currently only supported for playwright');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('warns on stderr but still exits with the run verdict if the report file is missing', async () => {
    const dir = await tmp();
    try {
      const p = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'does-not-exist.json');
      const { io, out, err } = makeIO();
      io.runSuite = async () => ({
        exitCode: 0, stdout: '', stderr: '', passed: true, durationMs: 5,
      });
      const code = await runCli(
        ['run', p, '--framework', 'playwright', '--report', rp],
        io,
      );
      // Run itself was green — exit 0 even though rendering failed
      expect(code).toBe(0);
      expect(out.join('')).toContain('PASS login flow');
      expect(err.join('')).toContain('could not read report');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('still exits 1 when the run failed even if --report rendering succeeds', async () => {
    const dir = await tmp();
    try {
      const p = await writeSuite(dir, 'suite.json', suite);
      const rp = join(dir, 'report.json');
      const { io, out } = makeIO();
      io.runSuite = async () => {
        await writeFile(rp, JSON.stringify(failingReport), 'utf8');
        return { exitCode: 1, stdout: '', stderr: '', passed: false, durationMs: 7 };
      };
      const code = await runCli(
        ['run', p, '--framework', 'playwright', '--report', rp],
        io,
      );
      expect(code).toBe(1);
      const stdout = out.join('');
      expect(stdout).toContain('FAIL login flow');
      expect(stdout).toContain('[XX] 2. fill');
      expect(stdout).toContain('[--] 3. click');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

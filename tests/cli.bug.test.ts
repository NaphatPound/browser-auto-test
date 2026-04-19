import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli, type CliIO } from '../src/cli.js';
import type { TestSuite } from '../src/types.js';

const suite: TestSuite = {
  name: 'login flow',
  steps: [
    { id: 's1', type: 'navigate', url: 'https://example.com' },
    { id: 's2', type: 'click', locator: { strategy: 'css', value: '#submit' } },
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
                    { title: 'page.click(#submit)', duration: 20, error: { message: 'locator not found' } },
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
    mkdir: async () => {},
  };
  return { io, out, err };
}

async function tmp() {
  return mkdtemp(join(tmpdir(), 'bat-cli-bug-'));
}

describe('runCli --export-bugs', () => {
  it('cmdReport: exports a bug report when failures exist', async () => {
    const dir = await tmp();
    try {
      const sp = join(dir, 'suite.json');
      await writeFile(sp, JSON.stringify(suite), 'utf8');
      const rp = join(dir, 'report.json');
      await writeFile(rp, JSON.stringify(failingReport), 'utf8');
      const bugMd = join(dir, 'bug.md');
      
      const { io, out } = makeIO();
      const code = await runCli(['report', sp, rp, '--export-bugs', bugMd], io);
      
      expect(code).toBe(1);
      expect(out.join('')).toContain(`exported 1 bug(s) to ${bugMd}`);
      const md = await readFile(bugMd, 'utf8');
      expect(md).toContain('# Bug Report: login flow');
      expect(md).toContain('**Failed Step**: #2 (click)');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('cmdRun: exports a bug report on failure', async () => {
    const dir = await tmp();
    try {
      const sp = join(dir, 'suite.json');
      await writeFile(sp, JSON.stringify(suite), 'utf8');
      const bugMd = join(dir, 'bug.md');
      
      const { io, out } = makeIO();
      io.runSuite = async (_s, _fw, opts) => {
        // Mock runner behavior
        const reportPath = opts.env?.PLAYWRIGHT_JSON_OUTPUT_NAME;
        if (reportPath) {
          await writeFile(reportPath, JSON.stringify(failingReport), 'utf8');
        }
        return { exitCode: 1, stdout: '', stderr: '', passed: false, durationMs: 200 };
      };
      
      const code = await runCli(['run', sp, '--framework', 'playwright', '--export-bugs', bugMd, '--cwd', dir], io);
      
      expect(code).toBe(1);
      expect(out.join('')).toContain(`exported 1 bug(s) to ${bugMd}`);
      const md = await readFile(bugMd, 'utf8');
      expect(md).toContain('# Bug Report: login flow');
      expect(md).toContain('**Failed Step**: #2 (click)');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('cmdRun: does not export a bug report on success', async () => {
    const dir = await tmp();
    try {
      const sp = join(dir, 'suite.json');
      await writeFile(sp, JSON.stringify(suite), 'utf8');
      const bugMd = join(dir, 'bug.md');
      
      const { io, out } = makeIO();
      io.runSuite = async (_s, _fw, opts) => {
        const reportPath = opts.env?.PLAYWRIGHT_JSON_OUTPUT_NAME;
        if (reportPath) {
          await writeFile(reportPath, JSON.stringify({ suites: [], stats: { duration: 10 } }), 'utf8');
        }
        return { exitCode: 0, stdout: '', stderr: '', passed: true, durationMs: 10 };
      };
      
      const code = await runCli(['run', sp, '--framework', 'playwright', '--export-bugs', bugMd, '--cwd', dir], io);
      
      expect(code).toBe(0);
      expect(out.join('')).not.toContain('exported');
      // Verify file was NOT created
      let exists = true;
      try { await readFile(bugMd); } catch { exists = false; }
      expect(exists).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

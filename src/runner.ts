import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Framework, TestSuite } from './types.js';
import { generate } from './codegen.js';

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  passed: boolean;
  durationMs: number;
}

export interface RunOptions {
  /** Stream stdout chunks to this callback. */
  onStdout?: (chunk: string) => void;
  /** Stream stderr chunks to this callback. */
  onStderr?: (chunk: string) => void;
  /** Override the executable. Defaults to per-framework conventions. */
  command?: string;
  /** Override CLI args. Defaults to `[<spec file>]`. */
  args?: string[];
  /** Extra args appended after the default/overridden args. */
  extraArgs?: string[];
  /** Working directory for the spawned process. Defaults to cwd of parent. */
  cwd?: string;
  /** Hard timeout (ms). Kills the process and resolves with exitCode=-1. */
  timeoutMs?: number;
  /** Extra env vars merged on top of process.env. */
  env?: Record<string, string | undefined>;
}

const DEFAULT_COMMAND: Record<Framework, string[]> = {
  playwright: ['npx', 'playwright', 'test'],
  puppeteer: ['node'],
  cypress: ['npx', 'cypress', 'run', '--spec'],
};

const SPEC_EXT: Record<Framework, string> = {
  playwright: '.spec.ts',
  puppeteer: '.mjs',
  cypress: '.cy.js',
};

/** Build the spawn command for a given framework + spec file. */
export function buildCommand(framework: Framework, specPath: string): { cmd: string; args: string[] } {
  const [cmd, ...rest] = DEFAULT_COMMAND[framework];
  return { cmd, args: [...rest, specPath] };
}

/** Write a generated suite to a temporary spec file. Returns the path. */
export async function writeSpec(suite: TestSuite, framework: Framework, dir?: string): Promise<string> {
  const code = generate(suite, framework);
  const targetDir = dir ?? (await mkdtemp(join(tmpdir(), 'bat-spec-')));
  const safe = (suite.name || 'suite').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || 'suite';
  const file = join(targetDir, `${safe}${SPEC_EXT[framework]}`);
  await writeFile(file, code, 'utf8');
  return file;
}

/** Spawn the framework CLI against a spec file. */
export function runSpec(specPath: string, framework: Framework, opts: RunOptions = {}): Promise<RunResult> {
  const built = buildCommand(framework, specPath);
  const cmd = opts.command ?? built.cmd;
  const baseArgs = opts.args ?? built.args;
  const args = opts.extraArgs ? [...baseArgs, ...opts.extraArgs] : baseArgs;
  const env = opts.env ? { ...process.env, ...opts.env } : process.env;

  return new Promise((resolve) => {
    const start = Date.now();
    let stdout = '';
    let stderr = '';
    const child = spawn(cmd, args, { cwd: opts.cwd, env });
    let timer: NodeJS.Timeout | undefined;

    if (opts.timeoutMs && opts.timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill('SIGKILL');
      }, opts.timeoutMs);
    }

    child.stdout.on('data', (buf: Buffer) => {
      const s = buf.toString('utf8');
      stdout += s;
      opts.onStdout?.(s);
    });
    child.stderr.on('data', (buf: Buffer) => {
      const s = buf.toString('utf8');
      stderr += s;
      opts.onStderr?.(s);
    });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      stderr += String(err.message ?? err);
      resolve({ exitCode: -1, stdout, stderr, passed: false, durationMs: Date.now() - start });
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      const exitCode = code ?? -1;
      resolve({
        exitCode,
        stdout,
        stderr,
        passed: exitCode === 0,
        durationMs: Date.now() - start,
      });
    });
  });
}

/** Convenience: write spec, run it, clean up. */
export async function runSuite(
  suite: TestSuite,
  framework: Framework,
  opts: RunOptions = {},
): Promise<RunResult> {
  const spec = await writeSpec(suite, framework);
  try {
    return await runSpec(spec, framework, opts);
  } finally {
    await rm(spec, { force: true }).catch(() => {});
  }
}

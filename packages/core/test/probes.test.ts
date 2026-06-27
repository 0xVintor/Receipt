/**
 * Probe behavior (PRD §6.4) + graceful degradation (§12.7): every probe returns
 * `unverifiable` (never throws) when its dependency is missing.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { buildGitContext } from '../src/git/index.js';
import { detectProject } from '../src/project/detect.js';
import { fileChangeProbe } from '../src/probes/fileChange.js';
import { packageInstallProbe } from '../src/probes/packageInstall.js';
import { commandRunProbe } from '../src/probes/commandRun.js';
import { testPassProbe } from '../src/probes/testPass.js';
import type { ProbeContext } from '../src/probes/types.js';
import type { Claim, RunEvent } from '../src/types.js';
import { tempDir, rm, write, initRepo, commitAll } from './helpers.js';

let repo: string;

async function makeCtx(events: RunEvent[] = [], opts: Partial<ProbeContext['opts']> = {}): Promise<ProbeContext> {
  const gitInfo = await buildGitContext(repo);
  return {
    projectPath: gitInfo.root,
    gitInfo,
    project: detectProject(gitInfo.root),
    opts: { ...opts },
    events,
    timeoutMs: 30000,
    cache: new Map(),
  };
}

const claim = (type: Claim['type'], target: string): Claim => ({
  id: 't',
  type,
  rawText: target,
  target,
  source: 'trace',
});

beforeEach(() => {
  repo = tempDir();
  write(repo, '.gitignore', 'node_modules/\n');
  write(repo, 'package.json', JSON.stringify({ name: 'x', dependencies: { zod: '^3' } }));
  write(repo, 'kept.js', 'v1\n');
  write(repo, 'changed.js', 'v1\n');
  initRepo(repo);
  commitAll(repo);
  // zod is actually installed (present in node_modules, gitignored)
  write(repo, 'node_modules/zod/package.json', JSON.stringify({ name: 'zod', version: '3.23.0' }));
});
afterEach(() => rm(repo));

describe('fileChange probe', () => {
  it('verified when a tracked file changed', async () => {
    write(repo, 'changed.js', 'v2 different\n');
    const ctx = await makeCtx();
    const r = await fileChangeProbe.run(claim('file_change', join(repo, 'changed.js')), ctx);
    expect(r.status).toBe('verified');
  });

  it('failed when the claimed file is unchanged', async () => {
    const ctx = await makeCtx();
    const r = await fileChangeProbe.run(claim('file_change', join(repo, 'kept.js')), ctx);
    expect(r.status).toBe('failed');
  });

  it('unverifiable when the file is outside the repo', async () => {
    const ctx = await makeCtx();
    const r = await fileChangeProbe.run(claim('file_change', '/etc/hosts'), ctx);
    expect(r.status).toBe('unverifiable');
  });
});

describe('packageInstall probe', () => {
  it('verified when present in manifest', async () => {
    const ctx = await makeCtx();
    const r = await packageInstallProbe.run(claim('package_install', 'zod'), ctx);
    expect(r.status).toBe('verified');
  });

  it('failed when absent everywhere (hallucinated)', async () => {
    const ctx = await makeCtx();
    const r = await packageInstallProbe.run(claim('package_install', 'ghostpkg-xyz'), ctx);
    expect(r.status).toBe('failed');
  });
});

describe('commandRun probe (read-only, trace-based)', () => {
  it('verified on exit 0 in trace', async () => {
    const events: RunEvent[] = [
      { role: 'assistant', toolName: 'Bash', toolInput: { command: 'mkdir -p src' }, toolExitCode: 0 },
    ];
    const ctx = await makeCtx(events);
    const r = await commandRunProbe.run(claim('command_run', 'mkdir -p src'), ctx);
    expect(r.status).toBe('verified');
  });

  it('failed on non-zero exit in trace', async () => {
    const events: RunEvent[] = [
      { role: 'assistant', toolName: 'Bash', toolInput: { command: 'rm nope' }, toolExitCode: 1 },
    ];
    const ctx = await makeCtx(events);
    const r = await commandRunProbe.run(claim('command_run', 'rm nope'), ctx);
    expect(r.status).toBe('failed');
  });

  it('unverifiable when no exit code recoverable', async () => {
    const events: RunEvent[] = [
      { role: 'assistant', toolName: 'Bash', toolInput: { command: 'weird' }, toolExitCode: null },
    ];
    const ctx = await makeCtx(events);
    const r = await commandRunProbe.run(claim('command_run', 'weird'), ctx);
    expect(r.status).toBe('unverifiable');
  });
});

describe('testPass probe — §12.7 graceful degradation', () => {
  it('unverifiable with --no-tests', async () => {
    const ctx = await makeCtx([], { noTests: true });
    const r = await testPassProbe.run(claim('test_pass', 'npm test'), ctx);
    expect(r.status).toBe('unverifiable');
  });

  it('unverifiable when the runner binary is missing (does not throw)', async () => {
    const ctx = await makeCtx();
    ctx.project.testCommand = 'definitely-not-a-real-binary-xyz run';
    const r = await testPassProbe.run(claim('test_pass', 'npm test'), ctx);
    expect(r.status).toBe('unverifiable');
  });

  it('unverifiable when no test runner detected', async () => {
    const ctx = await makeCtx();
    ctx.project.testCommand = undefined;
    const r = await testPassProbe.run(claim('test_pass', ''), ctx);
    expect(r.status).toBe('unverifiable');
  });
});

/**
 * Security regressions.
 *
 * 1. Probes must NEVER execute a command string taken from the transcript — only the
 *    project-detected test/build command (from package.json etc.). A malicious transcript
 *    must not be able to run arbitrary shell via Receipt.
 * 2. command_run is trace-only (read-only) — it never re-executes anything.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildGitContext } from '../src/git/index.js';
import { detectProject } from '../src/project/detect.js';
import { buildProbe } from '../src/probes/build.js';
import { testPassProbe } from '../src/probes/testPass.js';
import { commandRunProbe } from '../src/probes/commandRun.js';
import { endpointProbe, isLoopback } from '../src/probes/endpoint.js';
import type { ProbeContext } from '../src/probes/types.js';
import type { Claim } from '../src/types.js';
import { tempDir, rm, write, initRepo, commitAll } from './helpers.js';

let repo: string;
const markers: string[] = [];

afterEach(() => {
  if (repo) rm(repo);
  for (const m of markers) rm(m);
  markers.length = 0;
});

async function ctxFor(repoPath: string): Promise<ProbeContext> {
  const gitInfo = await buildGitContext(repoPath);
  return {
    projectPath: gitInfo.root,
    gitInfo,
    project: detectProject(gitInfo.root),
    opts: {},
    events: [],
    timeoutMs: 10000,
    cache: new Map(),
  };
}

const claim = (type: Claim['type'], target: string): Claim => ({ id: 'x', type, rawText: target, target, source: 'trace' });

describe('probes do not execute transcript-supplied commands', () => {
  it('build probe ignores a malicious claim.target and never runs it', async () => {
    repo = tempDir('sec-');
    // package.json WITHOUT a build script → project.buildCommand is undefined
    write(repo, 'package.json', JSON.stringify({ name: 'x', version: '1.0.0' }));
    initRepo(repo);
    commitAll(repo);

    const marker = join(tmpdir(), `RECEIPT_PWNED_build_${process.pid}`);
    markers.push(marker);
    const evil = `npm run build && touch ${marker}`;

    const ctx = await ctxFor(repo);
    const r = await buildProbe.run(claim('build', evil), ctx);

    expect(r.status).toBe('unverifiable'); // no detected build command → nothing run
    expect(existsSync(marker)).toBe(false); // the injected command did NOT execute
  });

  it('test probe ignores a malicious claim.target and never runs it', async () => {
    repo = tempDir('sec-');
    write(repo, 'package.json', JSON.stringify({ name: 'x', version: '1.0.0' }));
    initRepo(repo);
    commitAll(repo);

    const marker = join(tmpdir(), `RECEIPT_PWNED_test_${process.pid}`);
    markers.push(marker);
    const evil = `npm test ; touch ${marker}`;

    const ctx = await ctxFor(repo);
    const r = await testPassProbe.run(claim('test_pass', evil), ctx);

    expect(r.status).toBe('unverifiable');
    expect(existsSync(marker)).toBe(false);
  });

  it('command_run never executes anything (trace-only)', async () => {
    repo = tempDir('sec-');
    write(repo, 'package.json', JSON.stringify({ name: 'x' }));
    initRepo(repo);
    commitAll(repo);

    const marker = join(tmpdir(), `RECEIPT_PWNED_cmd_${process.pid}`);
    markers.push(marker);
    const ctx = await ctxFor(repo);
    // even though the command is in the trace, the probe only reads its recorded exit code
    ctx.events.push({ role: 'assistant', toolName: 'Bash', toolInput: { command: `touch ${marker}` }, toolExitCode: 0 });

    const r = await commandRunProbe.run(claim('command_run', `touch ${marker}`), ctx);
    expect(r.status).toBe('verified'); // verified from the recorded exit code
    expect(existsSync(marker)).toBe(false); // but the command was NOT re-run
  });
});

describe('endpoint probe SSRF guard', () => {
  it('classifies loopback vs non-loopback hosts', () => {
    expect(isLoopback('http://localhost:3000/health')).toBe(true);
    expect(isLoopback('http://127.0.0.1:8080/')).toBe(true);
    expect(isLoopback('http://169.254.169.254/latest/meta-data')).toBe(false);
    expect(isLoopback('https://evil.example.com/')).toBe(false);
  });

  it('refuses to probe a non-loopback URL from a claim (no --start-cmd)', async () => {
    repo = tempDir('sec-');
    write(repo, 'package.json', JSON.stringify({ name: 'x' }));
    initRepo(repo);
    commitAll(repo);
    const ctx = await ctxFor(repo);
    const r = await endpointProbe.run(
      claim('endpoint', 'http://169.254.169.254/latest/meta-data returns 200'),
      ctx,
    );
    expect(r.status).toBe('unverifiable');
    expect(r.evidence).toMatch(/SSRF/i);
  });
});

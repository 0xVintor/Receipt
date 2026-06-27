/**
 * End-to-end acceptance tests (PRD §12.1, §15 verification prompt, §12.3/4/7).
 *
 * Seeds a real git repo, replays a synthetic Claude Code session, runs the engine with
 * `--no-ai`, and asserts the verdict counts, the failed claims, exit code 2, that the repo
 * is not modified, and that the JSON validates against the Verdict schema.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { verifyRun, VerdictSchema, type VerifiedClaim } from '../src/index.js';
import {
  tempDir,
  rm,
  write,
  initRepo,
  commitAll,
  buildTranscript,
  exitCodeFor,
  git,
} from './helpers.js';
import { join } from 'node:path';

const FAILING_TEST = `const assert = require('assert');
try {
  assert.strictEqual(1 + 1, 3); // intentionally wrong
  console.log('PASS');
} catch {
  console.error('✗ auth > rejects expired token');
  process.exit(1);
}
`;

function seedNodeRepo(repo: string, deps: Record<string, string>, installedPkgs: string[]): void {
  write(repo, '.gitignore', 'node_modules/\n.receipt/\n');
  write(
    repo,
    'package.json',
    JSON.stringify({ name: 'demo', version: '1.0.0', scripts: { test: 'node run-tests.cjs' }, dependencies: deps }, null, 2),
  );
  write(repo, 'run-tests.cjs', FAILING_TEST);
  write(repo, 'a.js', 'export const a = 1;\n');
  write(repo, 'b.js', 'export const b = 1;\n');
  initRepo(repo);
  commitAll(repo);
  // installed packages live in node_modules (gitignored, untracked)
  for (const p of installedPkgs) {
    write(repo, `node_modules/${p}/package.json`, JSON.stringify({ name: p, version: '1.0.0' }));
  }
  // agent "edits"
  write(repo, 'a.js', 'export const a = 2; // edited\n');
  write(repo, 'b.js', 'export const b = 2; // edited\n');
}

const envKeys = [
  'RECEIPT_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'RECEIPT_PROVIDER',
];
const saved: Record<string, string | undefined> = {};
let home: string;
let sessions: string;
let sessionSeq = 0;
const sessionFile = () => join(sessions, `session-${sessionSeq++}.jsonl`);

beforeAll(() => {
  for (const k of envKeys) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  home = tempDir('receipt-home-');
  sessions = tempDir('receipt-sess-'); // transcripts live OUTSIDE the repos under test
  process.env.RECEIPT_HOME = home;
});

afterAll(() => {
  for (const k of envKeys) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rm(home);
  rm(sessions);
});

describe('§12.1 acceptance: 2 files edited, 1 package installed, tests claimed pass but fail', () => {
  let repo: string;
  beforeAll(() => {
    repo = tempDir();
    seedNodeRepo(repo, { leftpad: '^1.0.0' }, ['leftpad']);
  });
  afterAll(() => rm(repo));

  it('reports exactly 2 file_change verified, 1 package verified, 1 test_pass failed, overall fail, exit 2', async () => {
    const session = buildTranscript({
      cwd: repo,
      taskText: 'add last_login tracking to auth',
      
      toolCalls: [
        { name: 'Write', input: { file_path: join(repo, 'a.js') }, result: 'File written' },
        { name: 'Edit', input: { file_path: join(repo, 'b.js') }, result: 'File edited' },
        { name: 'Bash', input: { command: 'npm install leftpad' }, result: 'added 1 package', exitCode: 0 },
        { name: 'Bash', input: { command: 'npm test' }, result: 'PASS', exitCode: 0 },
      ],
      finalSummary: 'Edited a.js and b.js, installed leftpad, and all tests pass.',
    }, sessionFile());

    const { verdict } = await verifyRun({ session, cwd: repo, noAi: true, persist: false });

    const byTypeStatus = (type: string, status: string) =>
      verdict.claims.filter((c) => c.type === type && c.status === status).length;

    expect(verdict.claims).toHaveLength(4);
    expect(byTypeStatus('file_change', 'verified')).toBe(2);
    expect(byTypeStatus('package_install', 'verified')).toBe(1);
    expect(byTypeStatus('test_pass', 'failed')).toBe(1);
    expect(verdict.counts).toEqual({ verified: 3, failed: 1, unverifiable: 0 });
    expect(verdict.overall).toBe('fail');
    expect(exitCodeFor(verdict.overall)).toBe(2);

    // §12.4 — JSON validates against the Verdict schema
    expect(() => VerdictSchema.parse(JSON.parse(JSON.stringify(verdict)))).not.toThrow();
  });
});

describe('§15 verification: agent claims 7 actions but 2 are false', () => {
  let repo: string;
  beforeAll(() => {
    repo = tempDir();
    seedNodeRepo(repo, { zod: '^3.23.0' }, ['zod']);
    write(repo, 'c.test.js', 'export const c = 3;\n'); // agent-created new file
  });
  afterAll(() => rm(repo));

  it('confirms 5 verified, 2 failed (a hallucinated install + a red test), exit 2, repo untouched', async () => {
    const before = gitStatus(repo);

    const session = buildTranscript({
      cwd: repo,
      taskText: 'wire up zod validation and a migration',
      toolCalls: [
        { name: 'Write', input: { file_path: join(repo, 'a.js') } },
        { name: 'Edit', input: { file_path: join(repo, 'b.js') } },
        { name: 'Write', input: { file_path: join(repo, 'c.test.js') } },
        { name: 'Bash', input: { command: 'npm install zod' }, result: 'added 1 package', exitCode: 0 },
        { name: 'Bash', input: { command: 'mkdir -p src' }, result: '', exitCode: 0 },
        { name: 'Bash', input: { command: 'npm test' }, result: 'PASS', exitCode: 0 },
        { name: 'Bash', input: { command: 'npm install ghostpkg-xyz' }, result: 'added 1 package', exitCode: 0 },
      ],
      finalSummary: 'Installed zod and ghostpkg-xyz, edited files, created the test, and all tests pass.',
    }, sessionFile());

    const { verdict } = await verifyRun({ session, cwd: repo, noAi: true, persist: false });

    expect(verdict.claims).toHaveLength(7);
    expect(verdict.counts.verified).toBe(5);
    expect(verdict.counts.failed).toBe(2);
    expect(verdict.overall).toBe('fail');
    expect(exitCodeFor(verdict.overall)).toBe(2);

    const failed = verdict.claims.filter((c: VerifiedClaim) => c.status === 'failed');
    expect(failed.some((c) => c.type === 'test_pass')).toBe(true);
    expect(failed.some((c) => c.type === 'package_install' && c.target === 'ghostpkg-xyz')).toBe(true);

    // §12.3 — Receipt never modifies the user's repo
    expect(gitStatus(repo)).toEqual(before);
  });
});

describe('§12.2 keyless: no API key never errors and never needs the network', () => {
  it('runs fully deterministically with no key configured', async () => {
    const { isAiAvailable } = await import('../src/index.js');
    expect(isAiAvailable()).toBe(false); // no key in env or temp RECEIPT_HOME

    const repo = tempDir();
    try {
      seedNodeRepo(repo, {}, []);
      const session = buildTranscript({
        cwd: repo,
        taskText: 'edit a file',
        toolCalls: [{ name: 'Write', input: { file_path: join(repo, 'a.js') } }],
        finalSummary: 'Edited a.js.',
      }, sessionFile());
      const { verdict } = await verifyRun({ session, cwd: repo, persist: false }); // no noAi flag — relies on keyless default
      expect(verdict.aiUsed).toBeFalsy();
      expect(verdict.claims.length).toBeGreaterThan(0);
    } finally {
      rm(repo);
    }
  });
});

function gitStatus(repo: string): string {
  return git(repo, ['status', '--porcelain']);
}

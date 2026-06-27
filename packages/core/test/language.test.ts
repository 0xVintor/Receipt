/**
 * §12.6: Receipt works on a project in any language — probes shell out to the project's own
 * tools. A Python fixture exercises a non-Node path and confirms graceful degradation when
 * the test runner (pytest) isn't installed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'node:path';
import { verifyRun } from '../src/index.js';
import { detectProject } from '../src/project/detect.js';
import { tempDir, rm, write, initRepo, commitAll, buildTranscript } from './helpers.js';

describe('detectProject', () => {
  it('detects a python project', () => {
    const dir = tempDir();
    write(dir, 'pyproject.toml', "[project]\nname='x'\n");
    const p = detectProject(dir);
    expect(p.language).toBe('python');
    expect(p.testCommand).toContain('pytest');
    rm(dir);
  });

  it('detects a go project', () => {
    const dir = tempDir();
    write(dir, 'go.mod', 'module x\n');
    const p = detectProject(dir);
    expect(p.language).toBe('go');
    expect(p.testCommand).toBe('go test ./...');
    rm(dir);
  });
});

describe('Python project end-to-end (no Node toolchain)', () => {
  let repo: string;
  let sessions: string;
  beforeAll(() => {
    repo = tempDir();
    sessions = tempDir('py-sess-');
    write(repo, 'requirements.txt', 'requests==2.31.0\n');
    write(repo, 'app.py', "def add(a, b):\n    return a + b\n");
    write(repo, 'test_app.py', "from app import add\n\ndef test_add():\n    assert add(1, 1) == 2\n");
    initRepo(repo);
    commitAll(repo);
    write(repo, 'app.py', "def add(a, b):\n    return a + b  # edited\n");
  });
  afterAll(() => {
    rm(repo);
    rm(sessions);
  });

  it('verifies the python file edit and never throws on the test probe', async () => {
    const session = buildTranscript(
      {
        cwd: repo,
        taskText: 'edit the add function',
        toolCalls: [
          { name: 'Edit', input: { file_path: join(repo, 'app.py') } },
          { name: 'Bash', input: { command: 'pytest -q' }, result: 'ok', exitCode: 0 },
        ],
        finalSummary: 'Edited app.py and ran pytest.',
      },
      join(sessions, 's.jsonl'),
    );

    const { verdict } = await verifyRun({ session, cwd: repo, noAi: true, persist: false });

    const fileClaim = verdict.claims.find((c) => c.type === 'file_change');
    expect(fileClaim?.status).toBe('verified');

    const testClaim = verdict.claims.find((c) => c.type === 'test_pass');
    expect(testClaim).toBeDefined();
    // pytest is usually absent here → unverifiable; if present it's verified/failed. Never throws.
    expect(['verified', 'failed', 'unverifiable']).toContain(testClaim!.status);
  });
});

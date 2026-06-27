/**
 * Regression: an agent that COMMITS (and pushes) its work leaves a clean working tree.
 * Receipt must still verify those edits — looking at commits made during the session, not
 * only the uncommitted diff. Without this, every committed session falsely reports FAILED.
 *
 * (Found by running `receipt check` on a real session where the agent committed + pushed.)
 */
import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'node:path';
import { verifyRun } from '../src/index.js';
import { tempDir, rm, write, initRepo, commitAll, commitAllDated, buildTranscript, git } from './helpers.js';

let repo: string;
let sessions: string;
afterEach(() => {
  rm(repo);
  rm(sessions);
});

describe('committed-and-pushed edits still verify', () => {
  it('verifies a file the agent edited then committed (working tree clean)', async () => {
    repo = tempDir();
    sessions = tempDir('sess-');
    // baseline BEFORE the session window (09:00), so it is not what we are crediting
    write(repo, '.gitignore', 'node_modules/\n.receipt/\n');
    write(repo, 'a.js', 'export const a = 1;\n');
    initRepo(repo);
    commitAllDated(repo, 'baseline', '2026-06-26T09:00:00 +0000');

    // agent edits AND commits during the session window (the transcript starts at 10:00Z)
    write(repo, 'a.js', 'export const a = 2; // edited by agent\n');
    commitAllDated(repo, 'feat: bump a', '2026-06-26T11:00:00 +0000');

    // working tree is now CLEAN — the classic "no change since HEAD" trap
    expect(git(repo, ['status', '--porcelain']).trim()).toBe('');

    const session = buildTranscript(
      {
        cwd: repo,
        taskText: 'bump a and commit',
        toolCalls: [
          { name: 'Edit', input: { file_path: join(repo, 'a.js') } },
          { name: 'Bash', input: { command: 'git commit -am "feat: bump a"' }, exitCode: 0 },
        ],
        finalSummary: 'Edited a.js and committed the change.',
      },
      join(sessions, 's.jsonl'),
    );

    const { verdict } = await verifyRun({ session, cwd: repo, noAi: true, persist: false });

    const fc = verdict.claims.find((c) => c.type === 'file_change');
    expect(fc?.status).toBe('verified');
    expect(fc?.evidence).toMatch(/committed/i);
  });

  it('still FAILS a claimed edit to a file that was never touched (no false pass)', async () => {
    repo = tempDir();
    sessions = tempDir('sess-');
    write(repo, 'a.js', 'export const a = 1;\n');
    write(repo, 'b.js', 'export const b = 1;\n');
    initRepo(repo);
    commitAllDated(repo, 'baseline', '2026-06-26T09:00:00 +0000'); // before the session window

    // only a.js is edited+committed; b.js is never touched
    write(repo, 'a.js', 'export const a = 2;\n');
    commitAllDated(repo, 'edit a', '2026-06-26T11:00:00 +0000');

    const session = buildTranscript(
      {
        cwd: repo,
        taskText: 'edit a and b',
        toolCalls: [
          { name: 'Edit', input: { file_path: join(repo, 'a.js') } },
          { name: 'Edit', input: { file_path: join(repo, 'b.js') } }, // claimed but never done
        ],
        finalSummary: 'Edited a.js and b.js.',
      },
      join(sessions, 's.jsonl'),
    );

    const { verdict } = await verifyRun({ session, cwd: repo, noAi: true, persist: false });
    const byPath = (p: string) => verdict.claims.find((c) => c.type === 'file_change' && c.target?.endsWith(p));
    expect(byPath('a.js')?.status).toBe('verified');
    expect(byPath('b.js')?.status).toBe('failed'); // the fix must NOT make everything pass
  });
});

/**
 * Test helpers: build temp git repos and synthetic Claude Code transcripts that match the
 * real on-disk schema (verified against actual sessions, June 2026).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function tempDir(prefix = 'receipt-test-'): string {
  // realpath so paths match `git rev-parse --show-toplevel` (macOS /var -> /private/var).
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

export function rm(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

export function write(repo: string, rel: string, content: string): void {
  const path = join(repo, rel);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

export function git(repo: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  });
}

export function initRepo(repo: string): void {
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Test']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
}

export function commitAll(repo: string, message = 'baseline'): void {
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', message]);
}

// ---- synthetic transcript builder ----

export interface ToolCallSpec {
  name: string;
  input: Record<string, unknown>;
  result?: string; // tool_result text
  isError?: boolean;
  exitCode?: number; // if set, included in toolUseResult.code
}

export interface TranscriptSpec {
  cwd: string;
  taskText: string;
  toolCalls: ToolCallSpec[];
  finalSummary: string;
  sessionId?: string;
}

let counter = 1000;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}_${counter}`;
}

/** Write a synthetic Claude Code .jsonl transcript and return its path. */
export function buildTranscript(spec: TranscriptSpec, file?: string): string {
  const sessionId = spec.sessionId ?? 'test-session';
  const base = {
    cwd: spec.cwd,
    sessionId,
    version: '2.0.0',
    gitBranch: 'main',
  };
  const lines: unknown[] = [];
  let ts = Date.parse('2026-06-26T10:00:00.000Z');
  const stamp = () => new Date((ts += 1000)).toISOString();

  // task (genuine user message: string content)
  lines.push({
    ...base,
    type: 'user',
    uuid: nextId('u'),
    timestamp: stamp(),
    message: { role: 'user', content: spec.taskText },
  });

  for (const call of spec.toolCalls) {
    const id = nextId('toolu');
    lines.push({
      ...base,
      type: 'assistant',
      uuid: nextId('a'),
      timestamp: stamp(),
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id, name: call.name, input: call.input }],
      },
    });
    const isError = call.isError ?? false;
    const resultText = call.result ?? (isError ? 'Error: Exit code 1' : 'OK');
    const toolUseResult =
      call.exitCode != null
        ? { stdout: resultText, stderr: '', interrupted: false, code: call.exitCode }
        : isError
          ? `Error: ${resultText}`
          : { stdout: resultText, stderr: '', interrupted: false };
    lines.push({
      ...base,
      type: 'user',
      uuid: nextId('u'),
      timestamp: stamp(),
      toolUseResult,
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: id, content: resultText, is_error: isError }],
      },
    });
  }

  // final assistant narration
  lines.push({
    ...base,
    type: 'assistant',
    uuid: nextId('a'),
    timestamp: stamp(),
    message: { role: 'assistant', content: [{ type: 'text', text: spec.finalSummary }] },
  });

  const path = file ?? join(spec.cwd, 'transcript.jsonl');
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return path;
}

/** Exit-code mapping mirrored from the CLI (pass 0, warn 1, fail 2). */
export function exitCodeFor(overall: string): number {
  if (overall === 'fail') return 2;
  if (overall === 'warn') return 1;
  return 0;
}

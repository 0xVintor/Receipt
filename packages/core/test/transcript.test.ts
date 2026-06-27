/**
 * Claude Code transcript adapter (PRD §6.1). Validates parsing against a fixture that mirrors
 * the REAL on-disk schema, including noise events (summary/ai-title/attachment) that must be
 * ignored, tool_use↔tool_result joining, and exit-code derivation from is_error + result text.
 */
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadClaudeCodeSession } from '../src/transcript/claudeCode.js';
import { encodeProjectPath } from '../src/transcript/claudeCode.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, 'fixtures', 'claude-session.jsonl');

describe('encodeProjectPath', () => {
  it('replaces non-alphanumerics with dashes (matches the real folder encoding)', () => {
    expect(encodeProjectPath('/Users/x/Documents/Projects/new-project')).toBe(
      '-Users-x-Documents-Projects-new-project',
    );
    expect(encodeProjectPath('/a/b.c_d')).toBe('-a-b-c-d');
  });
});

describe('loadClaudeCodeSession', () => {
  const run = loadClaudeCodeSession(fixture, '/tmp/demo-proj');

  it('detects the agent and project path', () => {
    expect(run.agent).toBe('claude-code');
    expect(run.projectPath).toBe('/tmp/demo-proj');
  });

  it('extracts the genuine user task (not noise)', () => {
    expect(run.taskText).toBe('add last_login tracking to auth');
  });

  it('uses the last assistant text as the final summary', () => {
    expect(run.finalSummary).toContain('Edited src/auth/middleware.ts');
  });

  it('ignores summary / ai-title / attachment events', () => {
    // only user/assistant message events become RunEvents
    const roles = new Set(run.events.map((e) => e.role));
    expect([...roles].sort()).toEqual(['assistant', 'user']);
  });

  it('joins tool_use to tool_result and derives exit codes', () => {
    const write = run.events.find((e) => e.toolName === 'Write');
    expect(write?.toolInput?.file_path).toBe('/tmp/demo-proj/src/auth/middleware.ts');
    expect(write?.toolExitCode).toBe(0);
    expect(write?.isError).toBe(false);

    const bash = run.events.find((e) => e.toolName === 'Bash');
    expect(bash?.isError).toBe(true);
    expect(bash?.toolExitCode).toBe(1); // parsed from "Exit code 1"
    expect(bash?.toolResult).toContain('rejects expired token');
  });
});

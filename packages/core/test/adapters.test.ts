/**
 * Cross-agent adapters (PRD §7, Phase 7). Cursor/OpenClaw exports vary, so the generic
 * normalizer must handle: Anthropic-style content blocks, OpenAI-style tool_calls, and a
 * top-level { messages: [...] } wrapper. Synthetic fixtures prove the claim pipeline works.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadCursorSession } from '../src/transcript/cursor.js';
import { loadOpenClawSession } from '../src/transcript/openclaw.js';
import { extractRuleClaims } from '../src/claims/rules.js';
import { tempDir, rm } from './helpers.js';

let dir: string;
afterEach(() => {
  if (dir) rm(dir);
});

describe('Cursor adapter (generic normalizer)', () => {
  it('parses a JSON-array export with mixed content blocks + OpenAI tool_calls', () => {
    dir = tempDir('cursor-');
    const file = join(dir, 'export.json');
    writeFileSync(
      file,
      JSON.stringify([
        { role: 'user', content: 'add a util and run tests' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Writing the util.' },
            { type: 'tool_use', id: 't1', name: 'Write', input: { file_path: '/proj/util.ts' } },
          ],
        },
        {
          role: 'assistant',
          tool_calls: [{ id: 't2', function: { name: 'Bash', arguments: '{"command":"npm test"}' } }],
        },
        { role: 'assistant', content: [{ type: 'text', text: 'Done; all tests pass.' }] },
      ]),
    );

    const run = loadCursorSession(file, '/proj');
    expect(run.agent).toBe('cursor');
    expect(run.taskText).toContain('add a util');
    expect(run.finalSummary).toContain('all tests pass');

    const claims = extractRuleClaims(run.events);
    expect(claims.find((c) => c.type === 'file_change')?.target).toBe('/proj/util.ts');
    expect(claims.some((c) => c.type === 'test_pass')).toBe(true);
  });
});

describe('OpenClaw adapter (generic normalizer)', () => {
  it('parses a { workspace, messages } wrapper with an install command', () => {
    dir = tempDir('openclaw-');
    const file = join(dir, 'session.jsonl');
    writeFileSync(
      file,
      JSON.stringify({
        workspace: '/proj',
        messages: [
          { role: 'user', content: 'set up zod' },
          {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'a', name: 'Bash', input: { command: 'npm install zod' } }],
          },
          { role: 'assistant', content: 'Installed zod.' },
        ],
      }),
    );

    const run = loadOpenClawSession(file, '/fallback');
    expect(run.agent).toBe('openclaw');
    expect(run.projectPath).toBe('/proj');

    const claims = extractRuleClaims(run.events);
    expect(claims.find((c) => c.type === 'package_install')?.target).toBe('zod');
  });
});

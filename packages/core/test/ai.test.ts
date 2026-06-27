/**
 * Optional AI layer (PRD §6.3 / §6.6, Phase 6). The LLM call is mocked so we can prove the
 * wiring — zod validation, dedupe, and graceful fallback — WITHOUT a real key or network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the LLM client so isAiAvailable() is true and complete() is controllable.
vi.mock('../src/llm/client.js', () => ({
  isAiAvailable: () => true,
  complete: vi.fn(),
}));

import { complete } from '../src/llm/client.js';
import { extractProseClaims } from '../src/claims/ai.js';
import { synthesizeVerdict } from '../src/verdict/synthesize.js';
import type { Run, Claim, VerifiedClaim } from '../src/types.js';

const mockComplete = complete as unknown as ReturnType<typeof vi.fn>;

const run: Run = {
  agent: 'claude-code',
  projectPath: '/p',
  taskText: 'add an endpoint',
  finalSummary: 'The /health endpoint now returns 200 and all tests pass.',
  events: [{ role: 'assistant', toolName: 'Write', toolInput: { file_path: '/p/server.ts' } }],
  transcriptPath: '/p/t.jsonl',
};

beforeEach(() => mockComplete.mockReset());

describe('extractProseClaims (Phase 6)', () => {
  it('adds prose-only claims and tags them source:prose', async () => {
    mockComplete.mockResolvedValue([
      { type: 'endpoint', target: 'http://localhost:3000/health', rawText: 'endpoint returns 200' },
    ]);
    const existing: Claim[] = [{ id: 'f', type: 'file_change', target: '/p/server.ts', rawText: 'x', source: 'trace' }];
    const out = await extractProseClaims(run, existing, {});
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'endpoint', source: 'prose' });
  });

  it('dedupes prose claims against existing trace claims', async () => {
    mockComplete.mockResolvedValue([{ type: 'file_change', target: '/p/server.ts', rawText: 'edited server' }]);
    const existing: Claim[] = [{ id: 'f', type: 'file_change', target: '/p/server.ts', rawText: 'x', source: 'trace' }];
    expect(await extractProseClaims(run, existing, {})).toHaveLength(0);
  });

  it('falls back to [] on null / invalid LLM output (never blocks)', async () => {
    mockComplete.mockResolvedValue(null);
    expect(await extractProseClaims(run, [], {})).toEqual([]);
    mockComplete.mockResolvedValue({ not: 'an array' });
    expect(await extractProseClaims(run, [], {})).toEqual([]);
  });
});

describe('synthesizeVerdict AI one-liner (Phase 6)', () => {
  const claims: VerifiedClaim[] = [
    { id: '1', type: 'file_change', rawText: 'edited x', source: 'trace', status: 'verified', evidence: 'ok' },
    { id: '2', type: 'test_pass', rawText: 'tests', source: 'trace', status: 'failed', evidence: '1 failing' },
  ];

  it('uses the AI summary when available', async () => {
    mockComplete.mockResolvedValue('Reject — a test is red.');
    const v = await synthesizeVerdict(claims);
    expect(v.summary).toBe('Reject — a test is red.');
    expect(v.aiUsed).toBe(true);
    expect(v.overall).toBe('fail'); // counts/overall stay deterministic
  });

  it('falls back to the template when the LLM returns null', async () => {
    mockComplete.mockResolvedValue(null);
    const v = await synthesizeVerdict(claims);
    expect(v.aiUsed).toBeFalsy();
    expect(v.summary.toLowerCase()).toContain('do not trust');
  });
});

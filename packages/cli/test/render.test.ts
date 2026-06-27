/**
 * Receipt rendering (PRD §8). Colors disabled for stable substring assertions.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import chalk from 'chalk';
import type { Verdict } from '@receipt/core';
import { renderReceipt, renderQuiet, renderMarkdown, formatDuration } from '../src/render/receipt.js';

beforeAll(() => {
  chalk.level = 0; // strip ANSI
});

const verdict: Verdict = {
  overall: 'fail',
  summary: 'Do not trust as-is — a test is red.',
  counts: { verified: 2, failed: 1, unverifiable: 1 },
  agent: 'claude-code',
  taskText: 'add last_login tracking to auth',
  durationMs: 252000,
  claims: [
    { id: '1', type: 'file_change', rawText: 'edited middleware.ts', source: 'trace', status: 'verified', evidence: 'hash changed' },
    { id: '2', type: 'package_install', rawText: 'installed zod', source: 'trace', status: 'verified', evidence: 'in lockfile' },
    { id: '3', type: 'test_pass', rawText: '"all tests pass"', source: 'prose', status: 'failed', evidence: '1 failing: auth' },
    { id: '4', type: 'endpoint', rawText: '"endpoint returns 200"', source: 'prose', status: 'unverifiable', evidence: 'no dev server' },
  ],
};

describe('renderReceipt', () => {
  const out = renderReceipt(verdict);
  it('has the header with task and duration', () => {
    expect(out).toContain('RECEIPT');
    expect(out).toContain('add last_login tracking to auth');
    expect(out).toContain('4m12s');
  });
  it('has the headline counts', () => {
    expect(out).toContain('CLAIMED 4 actions');
    expect(out).toMatch(/verified 2/);
    expect(out).toMatch(/FAILED 1/);
  });
  it('renders a row per claim and the verdict', () => {
    expect(out).toContain('[✓]');
    expect(out).toContain('[✗]');
    expect(out).toContain('[?]');
    expect(out).toContain('VERDICT (fail)');
  });
});

describe('renderQuiet', () => {
  it('is a single line with the verdict', () => {
    const q = renderQuiet(verdict);
    expect(q.split('\n')).toHaveLength(1);
    expect(q).toContain('FAIL');
    expect(q).toContain('2✓');
  });
});

describe('renderMarkdown', () => {
  it('produces a table with all claims', () => {
    const md = renderMarkdown(verdict);
    expect(md).toContain('# Receipt — FAIL');
    expect(md).toContain('| Claim | Status | Evidence |');
    expect(md).toContain('installed zod');
  });

  it('redacts secrets in the persisted markdown (it can be committed/shared)', () => {
    const withSecret: Verdict = {
      ...verdict,
      claims: [
        {
          id: 's',
          type: 'command_run',
          rawText: 'ran `curl -H "Authorization: Bearer sk-livesecret12345" api`',
          source: 'trace',
          status: 'verified',
          evidence: 'exited 0',
        },
      ],
    };
    const md = renderMarkdown(withSecret);
    expect(md).not.toContain('sk-livesecret12345');
    expect(md).toContain('Bearer ***');
  });
});

describe('formatDuration', () => {
  it('formats seconds and minutes', () => {
    expect(formatDuration(9000)).toBe('9s');
    expect(formatDuration(252000)).toBe('4m12s');
    expect(formatDuration(undefined)).toBe('');
  });
});

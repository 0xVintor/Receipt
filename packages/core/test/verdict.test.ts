/**
 * Verdict synthesis rules (PRD §6.6): counts, overall (fail>warn>pass), templated one-liner.
 */
import { describe, it, expect } from 'vitest';
import { computeCounts, computeOverall, synthesizeVerdict } from '../src/verdict/synthesize.js';
import type { VerifiedClaim } from '../src/types.js';

const c = (status: VerifiedClaim['status'], rawText = 'x'): VerifiedClaim => ({
  id: 'i',
  type: 'file_change',
  rawText,
  source: 'trace',
  status,
  evidence: 'e',
});

describe('computeOverall', () => {
  it('fail if any failed', () => {
    expect(computeOverall(computeCounts([c('verified'), c('failed'), c('unverifiable')]))).toBe('fail');
  });
  it('warn if any unverifiable and none failed', () => {
    expect(computeOverall(computeCounts([c('verified'), c('unverifiable')]))).toBe('warn');
  });
  it('pass if all verified', () => {
    expect(computeOverall(computeCounts([c('verified'), c('verified')]))).toBe('pass');
  });
});

describe('synthesizeVerdict (no AI)', () => {
  it('produces counts + overall + a template summary', async () => {
    const v = await synthesizeVerdict([c('verified'), c('failed', 'applied the migration')], { noAi: true });
    expect(v.counts).toEqual({ verified: 1, failed: 1, unverifiable: 0 });
    expect(v.overall).toBe('fail');
    expect(v.summary.toLowerCase()).toContain('do not trust');
    expect(v.aiUsed).toBeFalsy();
  });

  it('pass summary when everything verifies', async () => {
    const v = await synthesizeVerdict([c('verified')], { noAi: true });
    expect(v.overall).toBe('pass');
    expect(v.summary.toLowerCase()).toContain('safe to accept');
  });
});

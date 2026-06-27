/**
 * Local store (PRD §6.8) + secret redaction (§13).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'node:path';
import { ReceiptStore, redact } from '../src/store/db.js';
import type { Run, Verdict } from '../src/types.js';
import { tempDir, rm } from './helpers.js';

let dir: string;
afterEach(() => {
  if (dir) rm(dir);
});

function sampleRun(cwd: string): Run {
  return {
    agent: 'claude-code',
    projectPath: cwd,
    taskText: 'do a thing with TOKEN=supersecret123',
    finalSummary: 'done',
    events: [],
    transcriptPath: join(cwd, 't.jsonl'),
  };
}

function sampleVerdict(): Verdict {
  return {
    overall: 'fail',
    summary: 'nope',
    counts: { verified: 1, failed: 1, unverifiable: 0 },
    claims: [
      { id: 'a', type: 'file_change', rawText: 'edited x', target: 'x.ts', source: 'trace', status: 'verified', evidence: 'hash changed' },
      { id: 'b', type: 'test_pass', rawText: 'ran tests', target: 'npm test', source: 'trace', status: 'failed', evidence: '1 failing' },
    ],
  };
}

describe('ReceiptStore', () => {
  it('saves, lists, and gets a run with correct counts', () => {
    dir = tempDir('receipt-store-');
    const store = new ReceiptStore(join(dir, 'receipt.db'));
    const id = store.saveRun({ run: sampleRun(dir), verdict: sampleVerdict() });

    const list = store.listRuns(10);
    expect(list).toHaveLength(1);
    expect(list[0]!.overall).toBe('fail');
    expect(list[0]!.counts).toEqual({ verified: 1, failed: 1, unverifiable: 0 });

    const got = store.getRun(id);
    expect(got).not.toBeNull();
    expect(got!.claims).toHaveLength(2);
    store.close();
  });

  it('redacts secrets in the persisted task text', () => {
    dir = tempDir('receipt-store-');
    const store = new ReceiptStore(join(dir, 'receipt.db'));
    const id = store.saveRun({ run: sampleRun(dir), verdict: sampleVerdict() });
    const got = store.getRun(id);
    expect(got!.run.taskText).not.toContain('supersecret123');
    expect(got!.run.taskText).toContain('TOKEN=***');
    store.close();
  });
});

describe('redact', () => {
  it('masks common secret shapes', () => {
    expect(redact('export API_KEY=abcd1234')).toContain('API_KEY=***');
    expect(redact('Authorization: Bearer abc.def.ghi')).toContain('Bearer ***');
    expect(redact('use sk-ABCDEFGH12345678 now')).toContain('sk-***');
    expect(redact('nothing here')).toBe('nothing here');
  });
});

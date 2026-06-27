/**
 * Dashboard data access. Reads ~/.receipt/receipt.db directly via Node 22's built-in
 * `node:sqlite` (read-only) — this avoids bundling the native `better-sqlite3` addon into
 * Next's server output, which can't locate its bindings file under .next/. Same schema as
 * @receipt/core's store (PRD §6.8).
 */
import { DatabaseSync } from 'node:sqlite';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type Overall = 'pass' | 'warn' | 'fail';
export type ProbeStatus = 'verified' | 'failed' | 'unverifiable';

export interface DashRun {
  id: string;
  agent: string;
  taskText: string;
  projectPath: string;
  overall: Overall;
  createdAt: string;
  counts: { verified: number; failed: number; unverifiable: number };
}

export interface DashClaim {
  id: string;
  type: string;
  rawText: string;
  target?: string;
  source: string;
  status: ProbeStatus;
  evidence: string;
  probe?: string;
}

function dbPath(): string {
  return join(process.env.RECEIPT_HOME || join(homedir(), '.receipt'), 'receipt.db');
}

function open(): InstanceType<typeof DatabaseSync> {
  return new DatabaseSync(dbPath(), { readOnly: true });
}

const COUNTS = `
  (SELECT COUNT(*) FROM claim c WHERE c.run_id = r.id AND c.status='verified') AS verified,
  (SELECT COUNT(*) FROM claim c WHERE c.run_id = r.id AND c.status='failed') AS failed,
  (SELECT COUNT(*) FROM claim c WHERE c.run_id = r.id AND c.status='unverifiable') AS unverifiable`;

export function getRuns(limit = 100): DashRun[] {
  let db: InstanceType<typeof DatabaseSync> | undefined;
  try {
    db = open();
    const rows = db
      .prepare(`SELECT r.*, ${COUNTS} FROM run r ORDER BY created_at DESC LIMIT ?`)
      .all(limit) as Record<string, unknown>[];
    return rows.map(toRun);
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

export function getRun(id: string): { run: DashRun; claims: DashClaim[] } | null {
  let db: InstanceType<typeof DatabaseSync> | undefined;
  try {
    db = open();
    const row = db.prepare(`SELECT r.*, ${COUNTS} FROM run r WHERE r.id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    const claims = db.prepare(`SELECT * FROM claim WHERE run_id = ?`).all(id) as Record<
      string,
      unknown
    >[];
    return { run: toRun(row), claims: claims.map(toClaim) };
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

function toRun(r: Record<string, unknown>): DashRun {
  return {
    id: String(r.id),
    agent: String(r.agent ?? 'unknown'),
    taskText: String(r.task_text ?? ''),
    projectPath: String(r.project_path ?? ''),
    overall: (r.overall as Overall) ?? 'pass',
    createdAt: String(r.created_at ?? ''),
    counts: {
      verified: Number(r.verified ?? 0),
      failed: Number(r.failed ?? 0),
      unverifiable: Number(r.unverifiable ?? 0),
    },
  };
}

function toClaim(c: Record<string, unknown>): DashClaim {
  return {
    id: String(c.id),
    type: String(c.type),
    rawText: String(c.raw_text ?? ''),
    target: c.target ? String(c.target) : undefined,
    source: String(c.source ?? 'trace'),
    status: (c.status as ProbeStatus) ?? 'unverifiable',
    evidence: String(c.evidence ?? ''),
    probe: c.probe ? String(c.probe) : undefined,
  };
}

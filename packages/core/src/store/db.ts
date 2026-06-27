/**
 * Local persistence (PRD §6.8). SQLite at ~/.receipt/receipt.db via better-sqlite3.
 *
 * Secrets are redacted before anything is written (PRD §13): we never store file contents,
 * and command/target/evidence strings are scrubbed of token-like values.
 */
import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { receiptHome } from '../config.js';
import type { Run, Verdict, VerifiedClaim } from '../types.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS run(
  id TEXT PRIMARY KEY, agent TEXT, project_path TEXT, task_text TEXT,
  started_at TEXT, finished_at TEXT, transcript_path TEXT, overall TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS claim(
  id TEXT PRIMARY KEY, run_id TEXT, type TEXT, raw_text TEXT,
  target TEXT, source TEXT, status TEXT, evidence TEXT, probe TEXT);
CREATE TABLE IF NOT EXISTS baseline(run_id TEXT, file_path TEXT, pre_hash TEXT);
CREATE TABLE IF NOT EXISTS snapshot(run_id TEXT, path TEXT, output_hash TEXT);
CREATE INDEX IF NOT EXISTS idx_claim_run ON claim(run_id);
CREATE INDEX IF NOT EXISTS idx_run_created ON run(created_at);
`;

export interface SavedRun {
  id: string;
  agent: string;
  projectPath: string;
  taskText: string;
  startedAt: string | null;
  finishedAt: string | null;
  transcriptPath: string;
  overall: string;
  createdAt: string;
  counts: { verified: number; failed: number; unverifiable: number };
}

export class ReceiptStore {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const path = dbPath ?? defaultDbPath();
    const dir = join(path, '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
  }

  saveRun(args: {
    runId?: string;
    run: Run;
    verdict: Verdict;
    baselines?: { filePath: string; preHash: string }[];
    snapshots?: { path: string; outputHash: string }[];
  }): string {
    const id = args.runId ?? nanoid(12);
    const createdAt = new Date().toISOString();

    const insertRun = this.db.prepare(
      `INSERT OR REPLACE INTO run(id, agent, project_path, task_text, started_at, finished_at, transcript_path, overall, created_at)
       VALUES (@id, @agent, @projectPath, @taskText, @startedAt, @finishedAt, @transcriptPath, @overall, @createdAt)`,
    );
    const insertClaim = this.db.prepare(
      `INSERT OR REPLACE INTO claim(id, run_id, type, raw_text, target, source, status, evidence, probe)
       VALUES (@id, @runId, @type, @rawText, @target, @source, @status, @evidence, @probe)`,
    );
    const insertBaseline = this.db.prepare(
      `INSERT INTO baseline(run_id, file_path, pre_hash) VALUES (?, ?, ?)`,
    );
    const insertSnapshot = this.db.prepare(
      `INSERT INTO snapshot(run_id, path, output_hash) VALUES (?, ?, ?)`,
    );

    const tx = this.db.transaction(() => {
      insertRun.run({
        id,
        agent: args.run.agent,
        projectPath: args.run.projectPath,
        taskText: redact(args.run.taskText).slice(0, 4000),
        startedAt: args.run.startedAt ?? null,
        finishedAt: args.run.finishedAt ?? null,
        transcriptPath: args.run.transcriptPath,
        overall: args.verdict.overall,
        createdAt,
      });
      for (const c of args.verdict.claims) {
        insertClaim.run({
          id: c.id,
          runId: id,
          type: c.type,
          rawText: redact(c.rawText),
          target: c.target ? redact(c.target) : null,
          source: c.source,
          status: c.status,
          evidence: redact(c.evidence),
          probe: c.probe ?? null,
        });
      }
      for (const b of args.baselines ?? []) insertBaseline.run(id, b.filePath, b.preHash);
      for (const s of args.snapshots ?? []) insertSnapshot.run(id, s.path, s.outputHash);
    });
    tx();
    return id;
  }

  listRuns(limit = 20): SavedRun[] {
    const rows = this.db
      .prepare(`SELECT * FROM run ORDER BY created_at DESC LIMIT ?`)
      .all(limit) as Record<string, string>[];
    return rows.map((r) => this.hydrate(r));
  }

  getRun(id: string): { run: SavedRun; claims: VerifiedClaim[] } | null {
    const row = this.db.prepare(`SELECT * FROM run WHERE id = ?`).get(id) as
      | Record<string, string>
      | undefined;
    if (!row) return null;
    const claims = this.db.prepare(`SELECT * FROM claim WHERE run_id = ?`).all(id) as Record<
      string,
      string
    >[];
    return {
      run: this.hydrate(row),
      claims: claims.map((c) => ({
        id: c.id!,
        type: c.type as VerifiedClaim['type'],
        rawText: c.raw_text!,
        target: c.target ?? undefined,
        source: c.source as VerifiedClaim['source'],
        status: c.status as VerifiedClaim['status'],
        evidence: c.evidence!,
        probe: c.probe ?? undefined,
      })),
    };
  }

  private hydrate(r: Record<string, string>): SavedRun {
    const counts = this.db
      .prepare(
        `SELECT
           SUM(status='verified') AS verified,
           SUM(status='failed') AS failed,
           SUM(status='unverifiable') AS unverifiable
         FROM claim WHERE run_id = ?`,
      )
      .get(r.id) as { verified: number; failed: number; unverifiable: number };
    return {
      id: r.id!,
      agent: r.agent!,
      projectPath: r.project_path!,
      taskText: r.task_text!,
      startedAt: r.started_at ?? null,
      finishedAt: r.finished_at ?? null,
      transcriptPath: r.transcript_path!,
      overall: r.overall!,
      createdAt: r.created_at!,
      counts: {
        verified: counts?.verified ?? 0,
        failed: counts?.failed ?? 0,
        unverifiable: counts?.unverifiable ?? 0,
      },
    };
  }

  close(): void {
    this.db.close();
  }
}

export function defaultDbPath(): string {
  return join(receiptHome(), 'receipt.db');
}

let singleton: ReceiptStore | null = null;
export function openStore(dbPath?: string): ReceiptStore {
  if (dbPath) return new ReceiptStore(dbPath);
  if (!singleton) singleton = new ReceiptStore();
  return singleton;
}

/** Scrub token-like secrets from a string before persisting (PRD §13). */
export function redact(input: string): string {
  if (!input) return input;
  let s = input;
  // KEY=VALUE style secrets
  s = s.replace(/\b([A-Z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD|PASSWD|PWD|CREDENTIAL)S?)\s*=\s*\S+/gi, '$1=***');
  // Authorization: Bearer xxx
  s = s.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._\-+/=]+/g, '$1 ***');
  // common provider key shapes
  s = s.replace(/\b(sk|pk|rk|ghp|gho|ghs|xox[baprs])[-_][A-Za-z0-9]{8,}\b/g, '$1-***');
  s = s.replace(/\bAKIA[0-9A-Z]{12,}\b/g, 'AKIA***');
  return s;
}

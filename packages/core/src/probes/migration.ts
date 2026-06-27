/**
 * migration probe (PRD §6.4, Phase 2b): verify a claimed table/column exists in the DB.
 *
 * Read-only introspection. Supports SQLite db files via better-sqlite3 (already a dependency).
 * Other db-urls (postgres/mysql) require drivers outside the locked stack → unverifiable with
 * a clear note. Without --db-url, always unverifiable.
 */
import { existsSync } from 'node:fs';
import type { Claim, ProbeResult } from '../types.js';
import { ok, type Probe, type ProbeContext } from './types.js';

export const migrationProbe: Probe = {
  type: 'migration',
  async run(claim: Claim, ctx: ProbeContext): Promise<ProbeResult> {
    try {
      const dbUrl = ctx.opts.dbUrl;
      if (!dbUrl) return ok('unverifiable', 'no database access (--db-url not set)', 'migration');

      const target = parseTarget(`${claim.target ?? ''} ${claim.rawText ?? ''}`);
      if (!target.table && !target.column) {
        return ok('unverifiable', 'could not parse a table/column from claim', 'migration');
      }

      const sqlitePath = sqliteFileFromUrl(dbUrl);
      if (!sqlitePath) {
        return ok('unverifiable', `unsupported db driver for ${scheme(dbUrl)} (sqlite only)`, 'migration');
      }
      if (!existsSync(sqlitePath)) {
        return ok('failed', `sqlite database not found at ${sqlitePath}`, 'migration');
      }

      const Database = (await import('better-sqlite3')).default;
      const db = new Database(sqlitePath, { readonly: true, fileMustExist: true });
      try {
        const tables = db
          .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view')")
          .all() as { name: string }[];
        const tableNames = new Set(tables.map((t) => t.name.toLowerCase()));

        if (target.table && !target.column) {
          return tableNames.has(target.table.toLowerCase())
            ? ok('verified', `table ${target.table} exists`, 'migration')
            : ok('failed', `table ${target.table} not found`, 'migration');
        }

        // column check — search the named table, or every table if none named
        const candidates = target.table ? [target.table] : [...tableNames];
        for (const tbl of candidates) {
          if (!tableNames.has(tbl.toLowerCase())) continue;
          const cols = db.prepare(`PRAGMA table_info(${quoteIdent(tbl)})`).all() as { name: string }[];
          if (cols.some((c) => c.name.toLowerCase() === target.column!.toLowerCase())) {
            return ok('verified', `column ${tbl}.${target.column} exists`, 'migration');
          }
        }
        return ok(
          'failed',
          `column ${target.column}${target.table ? ` not found in ${target.table}` : ' not found in any table'}`,
          'migration',
        );
      } finally {
        db.close();
      }
    } catch (e) {
      return ok('unverifiable', `probe error: ${errMsg(e)}`, 'migration');
    }
  },
};

interface MigrationTarget {
  table?: string;
  column?: string;
}

export function parseTarget(text: string): MigrationTarget {
  // "users.last_login" style
  const dotted = /\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\b/.exec(text);
  if (dotted) return { table: dotted[1], column: dotted[2] };
  const col = /\bcolumn\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(text);
  const tbl = /\btable\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(text);
  return { table: tbl?.[1], column: col?.[1] };
}

function sqliteFileFromUrl(url: string): string | null {
  if (url.startsWith('file:')) return url.slice('file:'.length).replace(/^\/\//, '');
  if (/\.(db|sqlite|sqlite3)$/i.test(url)) return url;
  if (url.startsWith('sqlite:')) return url.replace(/^sqlite:(\/\/)?/, '');
  return null;
}

function scheme(url: string): string {
  const m = /^(\w+):/.exec(url);
  return m ? m[1]! : 'unknown';
}

function quoteIdent(id: string): string {
  return '"' + id.replace(/"/g, '""') + '"';
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

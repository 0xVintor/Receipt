/**
 * Cursor transcript adapter (PRD §7, Phase 7) — best-effort.
 *
 * Cursor's local chat storage has moved around between releases (workspace SQLite blobs,
 * exported JSON). Rather than couple to a fragile internal store, this adapter handles an
 * explicit `--session <file>` export (JSON/JSONL) via the generic normalizer, and treats
 * auto-location as unavailable (returns null) so detection cleanly falls through to other
 * agents instead of guessing wrong.
 */
import { existsSync, readFileSync } from 'node:fs';
import type { Run } from '../types.js';
import { loadGenericSession } from './generic.js';

export function loadCursorSession(file: string, fallbackCwd: string): Run {
  return loadGenericSession(file, 'cursor', fallbackCwd);
}

export function locateLatestCursorSession(_cwd: string): string | null {
  // No stable, documented on-disk location to auto-detect across Cursor versions.
  // Users pass --session <export.json>. Returning null keeps auto-detection honest.
  return null;
}

export function isCursorTranscript(file: string): boolean {
  if (!existsSync(file)) return false;
  try {
    const head = readFileSync(file, 'utf8').slice(0, 4096).toLowerCase();
    return head.includes('cursor') && (head.includes('"role"') || head.includes('"messages"'));
  } catch {
    return false;
  }
}

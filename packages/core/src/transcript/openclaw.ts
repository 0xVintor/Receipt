/**
 * OpenClaw transcript adapter (PRD §7, Phase 7) — best-effort.
 *
 * OpenClaw persists agent sessions as JSON/JSONL. This adapter loads an explicit session
 * export through the generic normalizer and probes a couple of conventional locations
 * (~/.openclaw/sessions, ./.openclaw) for auto-detection.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Run } from '../types.js';
import { loadGenericSession } from './generic.js';

export function loadOpenClawSession(file: string, fallbackCwd: string): Run {
  return loadGenericSession(file, 'openclaw', fallbackCwd);
}

export function locateLatestOpenClawSession(cwd: string): string | null {
  const dirs = [join(cwd, '.openclaw', 'sessions'), join(homedir(), '.openclaw', 'sessions')];
  let best: { path: string; mtime: number } | null = null;
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    try {
      for (const f of readdirSync(dir)) {
        if (!f.endsWith('.json') && !f.endsWith('.jsonl')) continue;
        const path = join(dir, f);
        const mtime = statSync(path).mtimeMs;
        if (!best || mtime > best.mtime) best = { path, mtime };
      }
    } catch {
      /* ignore */
    }
  }
  return best?.path ?? null;
}

export function isOpenClawTranscript(file: string): boolean {
  if (!existsSync(file)) return false;
  try {
    const head = readFileSync(file, 'utf8').slice(0, 4096).toLowerCase();
    return head.includes('openclaw') || file.includes('.openclaw');
  } catch {
    return false;
  }
}

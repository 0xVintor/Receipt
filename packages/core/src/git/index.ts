/**
 * Git context for probes (PRD §6.4). READ-ONLY — nothing here ever mutates the repo.
 *
 * Receipt runs *after* the agent. The agent's edits may be:
 *   1. uncommitted working-tree changes (vs HEAD), OR
 *   2. committed (and possibly pushed) during the session.
 * Both must count as "the edit happened". So `touched` = working-tree changes ∪ files touched
 * by commits made within the session time window (and ∪ `git diff <--since ref>` when given).
 *
 * Without (2), every committed session would falsely report all edits as FAILED.
 */
import { existsSync, realpathSync } from 'node:fs';
import { relative, resolve, isAbsolute, sep, dirname, basename, join } from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';

/** realpath that tolerates missing files (resolves the nearest existing parent). */
function realpathSafe(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    try {
      return join(realpathSync(dirname(p)), basename(p));
    } catch {
      return p;
    }
  }
}

export interface GitInfo {
  isRepo: boolean;
  root: string; // repo root, or cwd when not a repo
  base: string; // 'HEAD' or the --since ref (baseline for hashing uncommitted changes)
  touched: Set<string>; // union of all changed paths (repo-relative, posix)
  worktreeTouched: Set<string>; // uncommitted changes vs HEAD
  committedTouched: Map<string, string>; // path -> short sha of a session/commit that touched it
  git: SimpleGit;
}

export interface GitWindow {
  /** Explicit diff baseline ref (--since). */
  sinceRef?: string;
  /** ISO timestamp of session start: commits at/after this are attributed to the agent. */
  sessionSince?: string;
}

export async function buildGitContext(cwd: string, window: GitWindow = {}): Promise<GitInfo> {
  const git = simpleGit({ baseDir: cwd, maxConcurrentProcesses: 1 });
  let isRepo = false;
  let root = realpathSafe(cwd);
  try {
    root = realpathSafe((await git.revparse(['--show-toplevel'])).trim() || cwd);
    isRepo = true;
  } catch {
    isRepo = false;
  }

  const base = window.sinceRef ?? 'HEAD';
  const worktreeTouched = new Set<string>();
  const committedTouched = new Map<string, string>();
  const rootGit = simpleGit({ baseDir: root, maxConcurrentProcesses: 1 });

  if (isRepo) {
    // 1) working-tree changes (uncommitted)
    try {
      const status = await rootGit.status();
      for (const f of status.files) if (f.path) worktreeTouched.add(toPosix(f.path));
      for (const r of status.renamed) {
        if (r.from) worktreeTouched.add(toPosix(r.from));
        if (r.to) worktreeTouched.add(toPosix(r.to));
      }
    } catch {
      /* status unavailable */
    }

    // 2) explicit --since ref → committed diff
    if (window.sinceRef) {
      try {
        const out = await rootGit.raw(['diff', '--name-only', window.sinceRef]);
        for (const line of out.split('\n')) {
          const p = line.trim();
          if (p && !committedTouched.has(toPosix(p))) committedTouched.set(toPosix(p), window.sinceRef);
        }
      } catch {
        /* invalid ref */
      }
    }

    // 3) commits made DURING the session (the agent committed/pushed its work)
    if (window.sessionSince) {
      try {
        const out = await rootGit.raw([
          'log',
          `--since=${window.sessionSince}`,
          '--name-only',
          '--pretty=format:%H',
        ]);
        let sha = '';
        for (const raw of out.split('\n')) {
          const line = raw.trim();
          if (!line) continue;
          if (/^[0-9a-f]{40}$/i.test(line)) {
            sha = line.slice(0, 8);
          } else {
            const p = toPosix(line);
            if (!committedTouched.has(p)) committedTouched.set(p, sha);
          }
        }
      } catch {
        /* log unavailable */
      }
    }
  }

  const touched = new Set<string>([...worktreeTouched, ...committedTouched.keys()]);

  return { isRepo, root, base, touched, worktreeTouched, committedTouched, git: rootGit };
}

/** Repo-relative posix path, or null if the file is outside the repo. */
export function repoRelative(info: GitInfo, filePath: string): string | null {
  const absRaw = isAbsolute(filePath) ? filePath : resolve(info.root, filePath);
  const abs = realpathSafe(absRaw);
  const root = realpathSafe(info.root);
  const rel = relative(root, abs);
  if (rel.startsWith('..') || isAbsolute(rel)) return null;
  return toPosix(rel);
}

/** Short blob hash of a path at the base ref, or null (e.g. untracked / new file). */
export async function hashAtBase(info: GitInfo, relPath: string): Promise<string | null> {
  try {
    const out = await info.git.raw(['rev-parse', `${info.base}:${relPath}`]);
    const h = out.trim();
    return h ? h.slice(0, 8) : null;
  } catch {
    return null;
  }
}

/** Short hash of the current working-tree file, or null if missing. */
export async function hashWorking(info: GitInfo, relPath: string): Promise<string | null> {
  const abs = resolve(info.root, relPath);
  if (!existsSync(abs)) return null;
  try {
    const out = await info.git.raw(['hash-object', abs]);
    const h = out.trim();
    return h ? h.slice(0, 8) : null;
  } catch {
    return null;
  }
}

function toPosix(p: string): string {
  return sep === '\\' ? p.split('\\').join('/') : p;
}

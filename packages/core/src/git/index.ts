/**
 * Git context for probes (PRD §6.4). READ-ONLY — nothing here ever mutates the repo.
 *
 * Receipt runs *after* the agent, so the "baseline" is the repo's base ref (HEAD by default,
 * or `--since <ref>`). The agent's edits are normally uncommitted working-tree changes, so the
 * set of touched files = `git status` (working tree vs HEAD) ∪ optional `git diff <since>`.
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
  base: string; // 'HEAD' or the --since ref
  touched: Set<string>; // repo-relative posix paths changed since base
  git: SimpleGit;
}

export async function buildGitContext(cwd: string, since?: string): Promise<GitInfo> {
  const git = simpleGit({ baseDir: cwd, maxConcurrentProcesses: 1 });
  let isRepo = false;
  let root = realpathSafe(cwd);
  try {
    root = realpathSafe((await git.revparse(['--show-toplevel'])).trim() || cwd);
    isRepo = true;
  } catch {
    isRepo = false;
  }

  const base = since ?? 'HEAD';
  const touched = new Set<string>();

  if (isRepo) {
    const rootGit = simpleGit({ baseDir: root, maxConcurrentProcesses: 1 });
    try {
      const status = await rootGit.status();
      for (const f of status.files) {
        if (f.path) touched.add(toPosix(f.path));
      }
      for (const r of status.renamed) {
        if (r.from) touched.add(toPosix(r.from));
        if (r.to) touched.add(toPosix(r.to));
      }
    } catch {
      /* status unavailable */
    }
    if (since) {
      try {
        const out = await rootGit.raw(['diff', '--name-only', since]);
        for (const line of out.split('\n')) {
          const p = line.trim();
          if (p) touched.add(toPosix(p));
        }
      } catch {
        /* invalid ref — ignore, working-tree diff still applies */
      }
    }
  }

  return { isRepo, root, base, touched, git: simpleGit({ baseDir: root, maxConcurrentProcesses: 1 }) };
}

/** Repo-relative posix path, or null if the file is outside the repo. */
export function repoRelative(info: GitInfo, filePath: string): string | null {
  const absRaw = isAbsolute(filePath) ? filePath : resolve(info.root, filePath);
  // realpath both sides so symlinked roots (e.g. macOS /var -> /private/var) still match.
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

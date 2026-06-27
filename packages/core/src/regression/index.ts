/**
 * Regression checks (PRD §6.5).
 *
 * Touched files = git diff since baseline. We reuse the test probe to re-run the suite (already
 * driven by the test_pass claims in the main flow). The extra value here is characterization
 * snapshots: for a touched source file with no obvious test, optionally capture a fixed-input
 * stdout hash under .receipt/snapshots/ so future runs can diff. Snapshots are opt-in (--snapshot)
 * and write ONLY under .receipt/ — never the user's source.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import type { GitInfo } from '../git/index.js';
import type { ProjectInfo } from '../project/detect.js';

export interface SnapshotRecord {
  path: string;
  outputHash: string;
  changed: boolean | null; // vs previous snapshot, null if first time
}

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|php)$/i;
const TEST_HINT = /(test|spec|__tests__)/i;

export function touchedSourceFiles(git: GitInfo): string[] {
  return [...git.touched].filter((p) => SOURCE_EXT.test(p) && !TEST_HINT.test(p));
}

/**
 * Capture characterization snapshots for touched source files. Currently snapshots the file's
 * own content hash (a stable, side-effect-free characterization). Returns per-file change status.
 */
export function captureSnapshots(git: GitInfo, _project: ProjectInfo): SnapshotRecord[] {
  const dir = join(git.root, '.receipt', 'snapshots');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const out: SnapshotRecord[] = [];
  for (const rel of touchedSourceFiles(git)) {
    const abs = resolve(git.root, rel);
    if (!existsSync(abs)) continue;
    const hash = createHash('sha256').update(readFileSync(abs)).digest('hex').slice(0, 16);
    const snapFile = join(dir, rel.replace(/[^A-Za-z0-9]/g, '_') + '.snap');
    let changed: boolean | null = null;
    if (existsSync(snapFile)) {
      const prev = readFileSync(snapFile, 'utf8').trim();
      changed = prev !== hash;
    }
    writeFileSync(snapFile, hash + '\n');
    out.push({ path: rel, outputHash: hash, changed });
  }
  return out;
}

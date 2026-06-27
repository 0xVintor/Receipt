/**
 * file_change probe (PRD §6.4): verified if the path changed during the session — either as
 * an uncommitted working-tree change OR in a commit the agent made during the session.
 * Failed if unchanged/missing; unverifiable if outside the repo.
 */
import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { Claim, ProbeResult } from '../types.js';
import { repoRelative, hashAtBase, hashWorking } from '../git/index.js';
import { ok, type Probe, type ProbeContext } from './types.js';

export const fileChangeProbe: Probe = {
  type: 'file_change',
  async run(claim: Claim, ctx: ProbeContext): Promise<ProbeResult> {
    try {
      const target = claim.target;
      if (!target) return ok('unverifiable', 'no file path in claim', 'fileChange');

      const abs = isAbsolute(target) ? target : resolve(ctx.projectPath, target);
      const exists = existsSync(abs);

      if (!ctx.gitInfo.isRepo) {
        return exists
          ? ok('unverifiable', 'no git repo to diff against (file exists)', 'fileChange')
          : ok('failed', 'file does not exist', 'fileChange');
      }

      const rel = repoRelative(ctx.gitInfo, abs);
      if (rel == null) {
        return ok('unverifiable', 'file is outside the git repo', 'fileChange');
      }

      // 1) uncommitted working-tree change
      if (ctx.gitInfo.worktreeTouched.has(rel)) {
        const [base, work] = await Promise.all([
          hashAtBase(ctx.gitInfo, rel),
          hashWorking(ctx.gitInfo, rel),
        ]);
        if (!exists) return ok('verified', 'deleted (uncommitted)', 'fileChange');
        if (base == null) return ok('verified', 'created (uncommitted)', 'fileChange');
        if (work && base !== work) return ok('verified', `hash changed ${base}→${work}`, 'fileChange');
        return ok('verified', 'changed (working tree)', 'fileChange');
      }

      // 2) committed during the session (and possibly pushed)
      const sha = ctx.gitInfo.committedTouched.get(rel);
      if (sha) {
        return ok('verified', `committed in ${sha}`, 'fileChange');
      }

      // 3) no evidence the file changed
      if (!exists) return ok('failed', 'file missing and never changed in this session', 'fileChange');
      return ok('failed', `no change found (working tree or commits since ${ctx.gitInfo.base})`, 'fileChange');
    } catch (e) {
      return ok('unverifiable', `probe error: ${errMsg(e)}`, 'fileChange');
    }
  },
};

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

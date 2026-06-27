/**
 * file_change probe (PRD §6.4): verified if the path changed in git since the baseline AND
 * its content hash differs; failed if unchanged/missing; unverifiable if outside the repo.
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

      const touched = ctx.gitInfo.touched.has(rel);
      if (touched) {
        const [base, work] = await Promise.all([
          hashAtBase(ctx.gitInfo, rel),
          hashWorking(ctx.gitInfo, rel),
        ]);
        if (base == null && !exists) {
          return ok('verified', `deleted (tracked at ${ctx.gitInfo.base})`, 'fileChange');
        }
        if (base == null) return ok('verified', 'created (new file)', 'fileChange');
        if (work == null) return ok('verified', `deleted (was ${base})`, 'fileChange');
        if (base === work) {
          return ok('failed', 'git lists it but content hash is unchanged', 'fileChange');
        }
        return ok('verified', `hash changed ${base}→${work}`, 'fileChange');
      }

      if (!exists) return ok('failed', `file missing and no change since ${ctx.gitInfo.base}`, 'fileChange');
      return ok('failed', `no change in git since ${ctx.gitInfo.base}`, 'fileChange');
    } catch (e) {
      return ok('unverifiable', `probe error: ${errMsg(e)}`, 'fileChange');
    }
  },
};

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

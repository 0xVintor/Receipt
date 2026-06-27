/**
 * build probe (PRD §6.4): run the detected build command; verified on exit 0, failed on
 * non-zero (capturing the error line), unverifiable when no build command exists or it times out.
 */
import type { Claim, ProbeResult } from '../types.js';
import { ok, type Probe, type ProbeContext } from './types.js';
import { runShell, lastLine, isMissingTool } from './exec.js';

export const buildProbe: Probe = {
  type: 'build',
  async run(_claim: Claim, ctx: ProbeContext): Promise<ProbeResult> {
    try {
      if (ctx.opts.noTests) return ok('unverifiable', 'build skipped (--no-tests)', 'build');

      // SECURITY: only ever run the project-detected build command (from package.json etc.),
      // never a command string taken from the (possibly untrusted) transcript.
      const cmd = ctx.project.buildCommand;
      if (!cmd) return ok('unverifiable', 'no build command detected for this project', 'build');

      const cacheKey = `build::${cmd}`;
      const cached = ctx.cache.get(cacheKey);
      if (cached) return cached;

      const r = await runShell(cmd, { cwd: ctx.project.root, timeoutMs: ctx.timeoutMs });
      let result: ProbeResult;
      if (r.timedOut) {
        result = ok('unverifiable', `build timed out: \`${short(cmd)}\``, 'build');
      } else if (r.code === 0) {
        result = ok('verified', `build succeeded (exit 0): \`${short(cmd)}\``, 'build');
      } else if (isMissingTool(r.code, r.stdout + '\n' + r.stderr)) {
        result = ok('unverifiable', `build tool not available: \`${short(cmd)}\``, 'build');
      } else {
        const line = lastLine(r.stderr, r.stdout) || `exit ${r.code}`;
        result = ok('failed', `build failed (exit ${r.code}): ${short(line)}`, 'build');
      }
      ctx.cache.set(cacheKey, result);
      return result;
    } catch (e) {
      return ok('unverifiable', `probe error: ${errMsg(e)}`, 'build');
    }
  },
};

function short(s: string): string {
  return s.length > 80 ? s.slice(0, 77) + '…' : s;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

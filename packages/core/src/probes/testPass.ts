/**
 * test_pass probe (PRD §6.4): re-run the test runner; verified on exit 0, failed otherwise
 * (capturing failing test names), unverifiable when no runner exists / tests are skipped /
 * the run times out. With --retries, a result that differs across runs is marked flaky.
 */
import type { Claim, ProbeResult } from '../types.js';
import { ok, type Probe, type ProbeContext } from './types.js';
import { runShell, isMissingTool } from './exec.js';

export const testPassProbe: Probe = {
  type: 'test_pass',
  async run(_claim: Claim, ctx: ProbeContext): Promise<ProbeResult> {
    try {
      if (ctx.opts.noTests) return ok('unverifiable', 'tests skipped (--no-tests)', 'testPass');

      // SECURITY: only ever run the project-detected test command, never a command string
      // pulled from the (possibly untrusted) transcript.
      const cmd = ctx.project.testCommand;
      if (!cmd) return ok('unverifiable', 'no test runner detected for this project', 'testPass');

      const cacheKey = `test::${cmd}`;
      const cached = ctx.cache.get(cacheKey);
      if (cached) return cached;

      const first = await runShell(cmd, { cwd: ctx.project.root, timeoutMs: ctx.timeoutMs });
      let result = toResult(cmd, first);

      const retries = ctx.opts.retries ?? 0;
      if (retries > 0 && result.status !== 'unverifiable') {
        const second = await runShell(cmd, { cwd: ctx.project.root, timeoutMs: ctx.timeoutMs });
        const secondResult = toResult(cmd, second);
        if (secondResult.status !== result.status) {
          result = ok('unverifiable', `flaky: differed across runs (${result.status} vs ${secondResult.status})`, 'testPass');
        }
      }

      ctx.cache.set(cacheKey, result);
      return result;
    } catch (e) {
      return ok('unverifiable', `probe error: ${errMsg(e)}`, 'testPass');
    }
  },
};

function toResult(cmd: string, r: { code: number; stdout: string; stderr: string; timedOut: boolean }): ProbeResult {
  if (r.timedOut) return ok('unverifiable', `test run timed out: \`${short(cmd)}\``, 'testPass');
  if (r.code === 0) return ok('verified', `tests passed (exit 0): \`${short(cmd)}\``, 'testPass');
  if (isMissingTool(r.code, r.stdout + '\n' + r.stderr)) {
    return ok('unverifiable', `test runner not available: \`${short(cmd)}\``, 'testPass');
  }
  const failing = extractFailing(r.stdout + '\n' + r.stderr);
  const detail = failing.length ? `${failing.length} failing: ${failing[0]}` : `exit ${r.code}`;
  return ok('failed', detail, 'testPass');
}

/** Best-effort failing-test extraction across common runners. */
function extractFailing(output: string): string[] {
  const out: string[] = [];
  const lines = output.split('\n');
  for (const line of lines) {
    const t = line.trim();
    // vitest/jest: "✗ name", "× name", "FAIL path", "● name"
    let m = /^(?:[×✗✕]|FAIL|●)\s+(.+)$/.exec(t);
    if (m && m[1]) out.push(clean(m[1]));
    // pytest: "FAILED tests/test_x.py::test_y"
    m = /^FAILED\s+(.+)$/.exec(t);
    if (m && m[1]) out.push(clean(m[1]));
    // "1) some test" mocha style failures section
    if (out.length >= 5) break;
  }
  return [...new Set(out)];
}

function clean(s: string): string {
  return s.replace(/\s+\d+ms$/, '').replace(/\s+\(\d+\s*ms\)$/, '').trim();
}

function short(cmd: string): string {
  return cmd.length > 60 ? cmd.slice(0, 57) + '…' : cmd;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

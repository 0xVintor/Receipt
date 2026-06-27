/**
 * command_run probe (PRD §6.4): verified if the trace shows exit 0 for that command;
 * failed if it shows a non-zero exit; unverifiable if no exit code is recoverable.
 *
 * Deliberately does NOT re-execute arbitrary commands — they may be non-idempotent or
 * destructive, and Receipt must stay read-only.
 */
import type { Claim, ProbeResult, RunEvent } from '../types.js';
import { ok, type Probe, type ProbeContext } from './types.js';

export const commandRunProbe: Probe = {
  type: 'command_run',
  async run(claim: Claim, ctx: ProbeContext): Promise<ProbeResult> {
    try {
      const cmd = claim.target;
      if (!cmd) return ok('unverifiable', 'no command in claim', 'commandRun');

      const ev = findCommandEvent(ctx.events, cmd);
      if (!ev) return ok('unverifiable', 'command not found in trace', 'commandRun');

      const code = ev.toolExitCode;
      if (code == null) {
        return ev.isError === true
          ? ok('failed', 'tool reported an error (no exit code)', 'commandRun')
          : ok('unverifiable', 'no exit code recoverable from trace', 'commandRun');
      }
      if (code === 0) return ok('verified', 'exited 0 (from trace)', 'commandRun');
      return ok('failed', `exited ${code} (from trace)`, 'commandRun');
    } catch (e) {
      return ok('unverifiable', `probe error: ${errMsg(e)}`, 'commandRun');
    }
  },
};

function findCommandEvent(events: RunEvent[], cmd: string): RunEvent | undefined {
  // exact match first, then a normalized-whitespace match
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  const target = norm(cmd);
  let match: RunEvent | undefined;
  for (const ev of events) {
    if (!ev.toolName) continue;
    const c = (ev.toolInput?.command as string) || (ev.toolInput?.cmd as string) || (ev.toolInput?.script as string);
    if (!c) continue;
    if (c === cmd || norm(c) === target) match = ev; // keep the last (most recent) occurrence
  }
  return match;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

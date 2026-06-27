/**
 * Probe interface + shared context (PRD §6.4). Every probe is READ-ONLY with respect to the
 * user's source, must time out, and must degrade to `unverifiable` instead of throwing.
 */
import type { Claim, ClaimType, ProbeResult, RunEvent, RunOptions } from '../types.js';
import type { GitInfo } from '../git/index.js';
import type { ProjectInfo } from '../project/detect.js';

export interface ProbeContext {
  projectPath: string;
  gitInfo: GitInfo;
  project: ProjectInfo;
  opts: RunOptions;
  events: RunEvent[];
  timeoutMs: number;
  /** memoizes expensive re-runs (test/build) keyed by command */
  cache: Map<string, ProbeResult>;
}

export interface Probe {
  type: ClaimType;
  run(claim: Claim, ctx: ProbeContext): Promise<ProbeResult>;
}

export function ok(status: ProbeResult['status'], evidence: string, probe?: string): ProbeResult {
  return { status, evidence, probe };
}

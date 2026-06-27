/**
 * Probe registry + dispatch (PRD §6.4).
 *
 * Claims are verified sequentially so the test/build memo-cache stays correct (no double runs
 * of the same suite) and so we never spike CPU by running many suites at once. Cheap probes
 * (file_change, package_install, command_run) are fast; the expensive ones cache by command.
 */
import type { Claim, ProbeResult, VerifiedClaim } from '../types.js';
import type { Probe, ProbeContext } from './types.js';
import { fileChangeProbe } from './fileChange.js';
import { packageInstallProbe } from './packageInstall.js';
import { testPassProbe } from './testPass.js';
import { commandRunProbe } from './commandRun.js';
import { buildProbe } from './build.js';
import { endpointProbe } from './endpoint.js';
import { migrationProbe } from './migration.js';

export const PROBES: Probe[] = [
  fileChangeProbe,
  packageInstallProbe,
  testPassProbe,
  commandRunProbe,
  buildProbe,
  endpointProbe,
  migrationProbe,
];

const REGISTRY = new Map<string, Probe>(PROBES.map((p) => [p.type, p]));

export function getProbe(type: string): Probe | undefined {
  return REGISTRY.get(type);
}

export async function verifyClaim(claim: Claim, ctx: ProbeContext): Promise<VerifiedClaim> {
  const probe = getProbe(claim.type);
  let result: ProbeResult;
  if (!probe) {
    result = { status: 'unverifiable', evidence: `no probe for type "${claim.type}"`, probe: 'none' };
  } else {
    try {
      result = await probe.run(claim, ctx);
    } catch (e) {
      // Defense in depth: probes already catch internally, but never let one throw fatally.
      result = {
        status: 'unverifiable',
        evidence: `probe crashed: ${e instanceof Error ? e.message : String(e)}`,
        probe: probe.type,
      };
    }
  }
  return { ...claim, ...result };
}

export async function verifyClaims(claims: Claim[], ctx: ProbeContext): Promise<VerifiedClaim[]> {
  const out: VerifiedClaim[] = [];
  for (const claim of claims) {
    out.push(await verifyClaim(claim, ctx));
  }
  return out;
}

export type { Probe, ProbeContext } from './types.js';

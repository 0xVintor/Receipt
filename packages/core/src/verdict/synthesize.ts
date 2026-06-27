/**
 * Verdict synthesis (PRD §6.6).
 *
 * Counts + overall are pure rules (deterministic):
 *   overall = fail if any failed; else warn if any unverifiable; else pass.
 * The one-line summary is templated by default; with AI enabled it asks for a friendlier
 * sentence and falls back to the template on any failure.
 */
import type { Overall, RunOptions, Verdict, VerifiedClaim } from '../types.js';
import { complete, isAiAvailable } from '../llm/client.js';
import { VERDICT_SUMMARY_SYSTEM, verdictSummaryUser } from '../llm/prompts.js';

export function computeCounts(claims: VerifiedClaim[]): Verdict['counts'] {
  let verified = 0;
  let failed = 0;
  let unverifiable = 0;
  for (const c of claims) {
    if (c.status === 'verified') verified++;
    else if (c.status === 'failed') failed++;
    else unverifiable++;
  }
  return { verified, failed, unverifiable };
}

export function computeOverall(counts: Verdict['counts']): Overall {
  if (counts.failed > 0) return 'fail';
  if (counts.unverifiable > 0) return 'warn';
  return 'pass';
}

export function templateSummary(overall: Overall, claims: VerifiedClaim[], counts: Verdict['counts']): string {
  const total = claims.length;
  if (total === 0) return 'No verifiable claims found in this run.';

  if (overall === 'fail') {
    const failures = claims.filter((c) => c.status === 'failed');
    const top = failures[0];
    const more = failures.length > 1 ? ` (+${failures.length - 1} more)` : '';
    return `Do not trust as-is — ${top ? `${stripVerb(top.rawText)}: ${top.evidence}` : 'a check failed'}${more}.`;
  }
  if (overall === 'warn') {
    return `Mostly good — ${counts.verified}/${total} verified, ${counts.unverifiable} unverifiable; review the unverifiable items before accepting.`;
  }
  return `Safe to accept — all ${total} claim${total === 1 ? '' : 's'} verified.`;
}

export async function synthesizeVerdict(
  claims: VerifiedClaim[],
  opts: RunOptions = {},
): Promise<Verdict> {
  const counts = computeCounts(claims);
  const overall = computeOverall(counts);
  let summary = templateSummary(overall, claims, counts);
  let aiUsed = false;

  if (isAiAvailable(opts)) {
    const problems = claims.filter((c) => c.status !== 'verified');
    try {
      const text = await complete({
        system: VERDICT_SUMMARY_SYSTEM,
        prompt: verdictSummaryUser({ counts, problems }),
        maxTokens: 80,
      });
      if (typeof text === 'string') {
        const cleaned = text.trim().replace(/^["'`]|["'`]$/g, '');
        if (cleaned && cleaned.length <= 240) {
          summary = cleaned;
          aiUsed = true;
        }
      }
    } catch {
      /* keep template */
    }
  }

  return { overall, summary, claims, counts, aiUsed };
}

function stripVerb(raw: string): string {
  return raw.replace(/^(wrote|edited|created|ran|installed|built|ran tests:)\s*/i, '').trim() || raw;
}

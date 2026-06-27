/**
 * Claim extraction orchestrator (PRD §6.2/§6.3).
 *
 *   extractClaims(run, opts) -> Claim[]
 *
 * Deterministic rule claims always run. The optional AI layer only adds prose-only claims
 * when a key is configured and --no-ai is not set; if it errors it contributes nothing.
 */
import type { Claim, Run, RunOptions } from '../types.js';
import { extractRuleClaims } from './rules.js';
import { extractProseClaims } from './ai.js';
import { isAiAvailable } from '../llm/client.js';

export async function extractClaims(run: Run, opts: RunOptions = {}): Promise<Claim[]> {
  const rule = extractRuleClaims(run.events);
  if (!isAiAvailable(opts)) return rule;
  const prose = await extractProseClaims(run, rule, opts);
  return [...rule, ...prose];
}

export { extractRuleClaims };

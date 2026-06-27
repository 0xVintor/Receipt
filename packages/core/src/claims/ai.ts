/**
 * Optional AI extraction of prose-only claims (PRD §6.3, Phase 6).
 *
 * Input: the agent's final summary + a compact tool-call list. Output: additional claims
 * asserted in narration but absent from the trace (e.g. "the endpoint now returns 200").
 * Strictly validated with zod; on ANY error returns [] so it can never block a run.
 */
import { nanoid } from 'nanoid';
import { z } from 'zod';
import type { Claim, Run, RunOptions } from '../types.js';
import { complete, isAiAvailable } from '../llm/client.js';
import { CLAIM_EXTRACTION_SYSTEM, claimExtractionUser } from '../llm/prompts.js';

const ProseClaim = z.object({
  type: z.enum(['file_change', 'package_install', 'test_pass', 'command_run', 'build', 'endpoint', 'migration']),
  target: z.string(),
  rawText: z.string(),
});
const ProseClaims = z.array(ProseClaim);

export async function extractProseClaims(
  run: Run,
  existing: Claim[],
  opts: RunOptions = {},
): Promise<Claim[]> {
  if (!isAiAvailable(opts)) return [];

  const toolCalls = run.events.filter((e) => e.toolName);
  const prompt = claimExtractionUser({
    taskText: run.taskText,
    finalSummary: run.finalSummary,
    toolCalls,
  });

  let parsed: z.infer<typeof ProseClaims> | null = null;
  try {
    const result = await complete({
      system: CLAIM_EXTRACTION_SYSTEM,
      prompt,
      schema: ProseClaims,
    });
    if (result == null) return [];
    parsed = ProseClaims.parse(result);
  } catch {
    return [];
  }

  const seen = new Set(existing.map((c) => `${c.type}::${c.target ?? c.rawText}`));
  const out: Claim[] = [];
  for (const p of parsed) {
    const key = `${p.type}::${p.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: nanoid(10), type: p.type, target: p.target, rawText: p.rawText, source: 'prose' });
  }
  return out;
}

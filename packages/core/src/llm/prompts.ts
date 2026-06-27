/**
 * Exact LLM prompts (PRD §9). These are the only places an LLM touches the pipeline, and
 * both are optional — the deterministic path never calls them.
 */
import type { RunEvent, VerifiedClaim } from '../types.js';

export const CLAIM_EXTRACTION_SYSTEM = `You are a verification assistant. You convert an AI coding agent's final summary and
tool-call list into a STRICT JSON array of VERIFIABLE claims. A claim is verifiable only
if it can be checked against a filesystem, git repo, package lockfile, test runner, HTTP
endpoint, database, or build. Do NOT include vague claims ("production-ready", "clean
code"). Output ONLY JSON.`;

export function claimExtractionUser(args: {
  taskText: string;
  finalSummary: string;
  toolCalls: RunEvent[];
}): string {
  const toolCallsList = args.toolCalls
    .filter((e) => e.toolName)
    .map((e) => {
      const target =
        (e.toolInput?.file_path as string) ||
        (e.toolInput?.command as string) ||
        '';
      return `- ${e.toolName}${target ? ` ${truncate(String(target), 100)}` : ''}`;
    })
    .join('\n');

  return `TASK: ${args.taskText}

AGENT FINAL SUMMARY:
${truncate(args.finalSummary, 6000)}

TOOL CALLS (already captured deterministically, do NOT repeat these):
${toolCallsList || '(none)'}

Return JSON: Array<{ "type": "file_change"|"package_install"|"test_pass"|"command_run"|"build"|"endpoint"|"migration", "target": string, "rawText": string }>
Only include claims that are asserted in the summary but NOT already in the tool calls.`;
}

export const VERDICT_SUMMARY_SYSTEM = `Write one terse sentence telling a developer whether to trust this agent run and why. No fluff.`;

export function verdictSummaryUser(args: {
  counts: { verified: number; failed: number; unverifiable: number };
  problems: VerifiedClaim[];
}): string {
  const lines = args.problems
    .map((c) => `- [${c.status}] ${c.rawText} — ${c.evidence}`)
    .join('\n');
  return `COUNTS: verified=${args.counts.verified} failed=${args.counts.failed} unverifiable=${args.counts.unverifiable}

NOTABLE CLAIMS:
${lines || '(all claims verified)'}

Write ONE sentence (max ~30 words). State trust/no-trust and the single most important reason.`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

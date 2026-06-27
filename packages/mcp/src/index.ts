/**
 * Receipt MCP server (PRD §9, Phase 9).
 *
 * Exposes one tool — `verify_last_run` — so an agent (or an orchestrator) can ask Receipt to
 * independently verify the most recent session in a project. Verification is deterministic;
 * the tool defaults to `--no-ai` and never persists.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { verifyRun, NoSessionError, type Verdict } from '@receipt/core';

export async function main(): Promise<void> {
  const server = new McpServer({ name: 'receipt', version: '0.1.0' });

  server.registerTool(
    'verify_last_run',
    {
      title: 'Verify last agent run',
      description:
        'Independently verify the claims made in the most recent AI coding-agent session for a ' +
        'project, against git, the filesystem, the package lockfile, the test runner and the ' +
        'build. Deterministic (no LLM judging). Returns counts (verified/failed/unverifiable), ' +
        'a per-claim breakdown, and a trust verdict (pass/warn/fail).',
      inputSchema: {
        cwd: z.string().optional().describe('Project directory to verify (default: server cwd).'),
        noTests: z.boolean().optional().describe('Skip re-running tests/build (faster).'),
        session: z.string().optional().describe('Explicit transcript file to verify.'),
        json: z.boolean().optional().describe('Return raw JSON only.'),
      },
    },
    async (args) => {
      try {
        const { verdict } = await verifyRun({
          cwd: args.cwd,
          noAi: true, // the MCP surface is deterministic by default
          noTests: args.noTests,
          session: args.session,
          persist: false,
        });
        const text = args.json ? JSON.stringify(verdict, null, 2) : formatVerdict(verdict);
        return { content: [{ type: 'text', text }] };
      } catch (e) {
        if (e instanceof NoSessionError) {
          return { content: [{ type: 'text', text: e.message }] };
        }
        return {
          content: [{ type: 'text', text: `Receipt error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function formatVerdict(v: Verdict): string {
  const icon = { verified: '✓', failed: '✗', unverifiable: '?' } as const;
  const lines = v.claims.map((c) => `[${icon[c.status]}] ${c.rawText} — ${c.status} (${c.evidence})`);
  return [
    `VERDICT: ${v.overall.toUpperCase()}`,
    `Claimed ${v.claims.length} — verified ${v.counts.verified}, failed ${v.counts.failed}, unverifiable ${v.counts.unverifiable}`,
    v.taskText ? `Task: ${oneLine(v.taskText, 120)}` : '',
    '',
    ...lines,
    '',
    v.summary,
  ]
    .filter((l) => l !== '')
    .join('\n');
}

function oneLine(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

/**
 * Core data types for Receipt (PRD §4).
 *
 * The public shapes (Run, Claim, ProbeResult, Verdict, ...) match the PRD exactly.
 * A few optional fields are added to RunEvent (toolUseId, isError, durationMs) because
 * the real Claude Code transcript carries them and the probes benefit — they are additive
 * and never required by consumers.
 */

export type AgentKind = 'claude-code' | 'cursor' | 'openclaw';

export interface RunEvent {
  role: 'user' | 'assistant' | 'system';
  text?: string; // natural-language content
  toolName?: string; // e.g. 'Edit', 'Write', 'Bash'
  toolInput?: Record<string, unknown>; // arguments the agent passed
  toolResult?: string; // stringified tool output
  toolExitCode?: number | null; // if derivable
  ts?: string;

  // Additive (not in PRD §4 but present in real transcripts; always optional):
  toolUseId?: string; // links tool_use -> tool_result
  isError?: boolean; // tool_result.is_error, the cleanest success/failure signal
  durationMs?: number; // tool wall-clock if reported
}

export interface Run {
  agent: AgentKind;
  projectPath: string; // cwd of the session
  taskText: string; // the user's request that started the turn
  finalSummary: string; // agent's last assistant text (the "claims" prose)
  events: RunEvent[];
  transcriptPath: string;
  startedAt?: string;
  finishedAt?: string;
}

export type ClaimType =
  | 'file_change'
  | 'package_install'
  | 'test_pass'
  | 'command_run'
  | 'build'
  | 'endpoint'
  | 'migration';

export interface Claim {
  id: string;
  type: ClaimType;
  rawText: string; // how the agent phrased it
  target?: string; // file path / package name / command / url / column
  source: 'trace' | 'prose'; // trace = from tool_use (deterministic), prose = from narration
}

export type ProbeStatus = 'verified' | 'failed' | 'unverifiable';

export interface ProbeResult {
  status: ProbeStatus;
  evidence: string; // human-readable proof, e.g. "hash changed a1b2->c3d4"
  probe?: string; // which probe produced this (for the store)
}

export interface VerifiedClaim extends Claim, ProbeResult {}

export type Overall = 'pass' | 'warn' | 'fail';

export interface Verdict {
  overall: Overall;
  summary: string; // one-line plain-language verdict
  claims: VerifiedClaim[];
  counts: { verified: number; failed: number; unverifiable: number };
  // Additive context for rendering / store (always optional):
  agent?: AgentKind;
  taskText?: string;
  projectPath?: string;
  durationMs?: number;
  runId?: string;
  aiUsed?: boolean;
}

/** Options threaded from the CLI down into the engine. */
export interface RunOptions {
  session?: string; // explicit transcript path
  agent?: AgentKind; // force an agent adapter
  noAi?: boolean; // deterministic only
  noTests?: boolean; // skip re-running tests
  timeoutSec?: number; // per-probe timeout (default 120)
  snapshot?: boolean; // capture characterization snapshots
  since?: string; // git ref bounding the task window
  retries?: number; // flaky-test re-run count
  startCmd?: string; // dev server start command (endpoint probe)
  dbUrl?: string; // database URL (migration probe)
  cwd?: string; // override project cwd (defaults to process.cwd())
  persist?: boolean; // write to the local SQLite store (default true)
}

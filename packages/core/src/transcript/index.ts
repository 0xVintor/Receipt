/**
 * Transcript detection + loading entry point (PRD §6.1).
 *
 *   detectAndLoad(opts) -> Run
 *
 * Auto-detects the agent and the latest session for the current cwd, or loads an explicit
 * --session file. Throws NoSessionError when there is nothing to verify (the CLI turns this
 * into a friendly message + exit 0, per §13).
 */
import { existsSync, statSync } from 'node:fs';
import type { AgentKind, Run, RunOptions } from '../types.js';
import {
  loadClaudeCodeSession,
  locateLatestSession,
  isClaudeCodeTranscript,
} from './claudeCode.js';
import { loadCursorSession, isCursorTranscript, locateLatestCursorSession } from './cursor.js';
import { loadOpenClawSession, isOpenClawTranscript, locateLatestOpenClawSession } from './openclaw.js';

export class NoSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoSessionError';
  }
}

export async function detectAndLoad(opts: RunOptions = {}): Promise<Run> {
  const cwd = opts.cwd ?? process.cwd();

  // Explicit transcript path
  if (opts.session) {
    if (!existsSync(opts.session)) {
      throw new NoSessionError(`Session file not found: ${opts.session}`);
    }
    const agent = opts.agent ?? sniffAgent(opts.session);
    return loadByAgent(agent, opts.session, cwd);
  }

  // Forced agent, auto-locate latest for that agent
  if (opts.agent) {
    const file = locateForAgent(opts.agent, cwd);
    if (!file) throw new NoSessionError(noSessionMessage(opts.agent, cwd));
    return loadByAgent(opts.agent, file, cwd);
  }

  // Auto-detect: try each agent, newest session wins
  const candidates: { agent: AgentKind; file: string; mtime: number }[] = [];
  for (const [agent, locate] of [
    ['claude-code', locateLatestSession],
    ['cursor', locateLatestCursorSession],
    ['openclaw', locateLatestOpenClawSession],
  ] as const) {
    try {
      const file = locate(cwd);
      if (file && existsSync(file)) {
        candidates.push({ agent, file, mtime: safeMtime(file) });
      }
    } catch {
      /* adapter not available / nothing found */
    }
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  if (!candidates.length) throw new NoSessionError(noSessionMessage(undefined, cwd));
  const best = candidates[0]!;
  return loadByAgent(best.agent, best.file, cwd);
}

function loadByAgent(agent: AgentKind, file: string, cwd: string): Run {
  switch (agent) {
    case 'cursor':
      return loadCursorSession(file, cwd);
    case 'openclaw':
      return loadOpenClawSession(file, cwd);
    case 'claude-code':
    default:
      return loadClaudeCodeSession(file, cwd);
  }
}

function locateForAgent(agent: AgentKind, cwd: string): string | null {
  switch (agent) {
    case 'cursor':
      return locateLatestCursorSession(cwd);
    case 'openclaw':
      return locateLatestOpenClawSession(cwd);
    case 'claude-code':
    default:
      return locateLatestSession(cwd);
  }
}

/** Best-effort agent sniff from a transcript file's contents. */
export function sniffAgent(file: string): AgentKind {
  if (isClaudeCodeTranscript(file)) return 'claude-code';
  if (isCursorTranscript(file)) return 'cursor';
  if (isOpenClawTranscript(file)) return 'openclaw';
  // default: treat as claude-code (most common, most forgiving parser)
  return 'claude-code';
}

function safeMtime(file: string): number {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

function noSessionMessage(agent: AgentKind | undefined, cwd: string): string {
  const who = agent ? `${agent} ` : '';
  return `No ${who}session found for ${cwd}. Nothing to verify.`;
}

export { loadClaudeCodeSession, locateLatestSession } from './claudeCode.js';

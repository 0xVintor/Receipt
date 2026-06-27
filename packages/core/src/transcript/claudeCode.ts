/**
 * Claude Code transcript adapter (PRD §6.1).
 *
 * Verified against real sessions on disk (June 2026). Notable realities the PRD flagged to
 * VERIFY and how this adapter handles them:
 *  - Session files: ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl where <encoded-cwd>
 *    is the absolute cwd with every non-alphanumeric char replaced by '-'. We DON'T trust the
 *    encoding blindly — we also confirm by reading the `cwd` field inside each file.
 *  - Many event `type`s exist beyond user/assistant/system (ai-title, mode, attachment,
 *    queue-operation, last-prompt, summary, ...). We ignore everything except message events.
 *  - Tool results arrive in a *user* event as a `tool_result` block joined by `tool_use_id`,
 *    plus a rich top-level `toolUseResult` ({stdout,stderr,interrupted,code} | "Error: Exit code N…").
 *  - Genuine user prompts have `message.content` as a *string*; tool-result carriers use arrays.
 */
import { existsSync, readFileSync, readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Run, RunEvent } from '../types.js';
import {
  parseJsonl,
  contentToText,
  deriveToolResult,
  attachResults,
  isInjectedUserText,
  type ToolResult,
} from './normalize.js';

export interface SessionCandidate {
  path: string;
  mtimeMs: number;
  cwd: string;
}

export function projectsRoot(): string {
  return join(homedir(), '.claude', 'projects');
}

/** Claude Code's folder encoding: replace every non-alphanumeric character with '-'. */
export function encodeProjectPath(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-');
}

/** Cheaply read the first `cwd` field from a (possibly huge) jsonl file. */
function peekCwd(file: string): string | null {
  let fd: number | undefined;
  try {
    fd = openSync(file, 'r');
    const buf = Buffer.alloc(64 * 1024);
    const bytes = readSync(fd, buf, 0, buf.length, 0);
    const chunk = buf.subarray(0, bytes).toString('utf8');
    for (const line of chunk.split('\n')) {
      const t = line.trim();
      if (!t || !t.includes('"cwd"')) continue;
      try {
        const o = JSON.parse(t) as Record<string, unknown>;
        if (typeof o.cwd === 'string') return o.cwd;
      } catch {
        // partial last line — ignore
      }
    }
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  return null;
}

function listJsonl(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
}

/**
 * Find candidate session files whose cwd matches `cwd`, most-recent first.
 * Strategy: look in the encoded directory first; if nothing matches, scan all project dirs.
 */
export function findSessionsForCwd(cwd: string): SessionCandidate[] {
  const target = safeResolve(cwd);
  const root = projectsRoot();
  if (!existsSync(root)) return [];

  const tryFiles = (files: string[]): SessionCandidate[] => {
    const out: SessionCandidate[] = [];
    for (const path of files) {
      const fileCwd = peekCwd(path);
      if (fileCwd && safeResolve(fileCwd) === target) {
        try {
          out.push({ path, mtimeMs: statSync(path).mtimeMs, cwd: fileCwd });
        } catch {
          /* ignore unreadable */
        }
      }
    }
    return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  };

  // 1) the encoded directory (the common, fast path)
  const encodedDir = join(root, encodeProjectPath(cwd));
  const fromEncoded = existsSync(encodedDir) ? tryFiles(listJsonl(encodedDir)) : [];
  if (fromEncoded.length) return fromEncoded;

  // 2) fall back to scanning every project directory and matching by cwd field
  const allFiles: string[] = [];
  try {
    for (const entry of readdirSync(root)) {
      const dir = join(root, entry);
      try {
        if (statSync(dir).isDirectory()) allFiles.push(...listJsonl(dir));
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
  return tryFiles(allFiles);
}

/** Locate the most-recent session file for a cwd, or null. */
export function locateLatestSession(cwd: string): string | null {
  const found = findSessionsForCwd(cwd);
  return found.length ? found[0]!.path : null;
}

/** True if this file looks like a Claude Code transcript. */
export function isClaudeCodeTranscript(file: string): boolean {
  if (!file.endsWith('.jsonl')) return false;
  const cwd = peekCwd(file);
  return cwd != null;
}

/** Parse a Claude Code .jsonl transcript into a Run. */
export function loadClaudeCodeSession(file: string, fallbackCwd: string): Run {
  const raw = readFileSync(file, 'utf8');
  const records = parseJsonl(raw) as Record<string, unknown>[];

  const events: RunEvent[] = [];
  const results = new Map<string, ToolResult>();

  let projectPath = fallbackCwd;
  let startedAt: string | undefined;
  let finishedAt: string | undefined;

  for (const o of records) {
    if (!o || typeof o !== 'object') continue;
    const type = o.type;
    if (typeof o.cwd === 'string' && o.cwd) projectPath = o.cwd;
    const ts = typeof o.timestamp === 'string' ? o.timestamp : undefined;
    if (ts) {
      if (!startedAt) startedAt = ts;
      finishedAt = ts;
    }

    const message = o.message as Record<string, unknown> | undefined;

    if (type === 'assistant' && message && Array.isArray(message.content)) {
      for (const block of message.content as Record<string, unknown>[]) {
        if (!block || typeof block !== 'object') continue;
        if (block.type === 'text' && typeof block.text === 'string') {
          events.push({ role: 'assistant', text: block.text, ts });
        } else if (block.type === 'tool_use' && typeof block.name === 'string') {
          events.push({
            role: 'assistant',
            toolName: block.name,
            toolInput: (block.input as Record<string, unknown>) ?? {},
            toolUseId: typeof block.id === 'string' ? block.id : undefined,
            ts,
          });
        }
      }
    } else if (type === 'user' && message) {
      const content = message.content;
      if (typeof content === 'string') {
        events.push({ role: 'user', text: content, ts });
      } else if (Array.isArray(content)) {
        for (const block of content as Record<string, unknown>[]) {
          if (!block || typeof block !== 'object') continue;
          if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
            results.set(block.tool_use_id, deriveToolResult(block, o.toolUseResult));
          } else if (block.type === 'text' && typeof block.text === 'string') {
            events.push({ role: 'user', text: block.text, ts });
          }
        }
      }
    } else if (type === 'system') {
      const text = typeof o.content === 'string' ? o.content : contentToText((o.message as Record<string, unknown>)?.content);
      if (text) events.push({ role: 'system', text, ts });
    }
  }

  attachResults(events, results);

  // Prefer the latest task turn for duration: start at the last genuine user message so the
  // header reflects "this task" rather than a whole resumed session.
  const taskStart = lastGenuineUserTs(events) ?? startedAt;

  return {
    agent: 'claude-code',
    projectPath,
    taskText: deriveTaskText(events),
    finalSummary: deriveFinalSummary(events),
    events,
    transcriptPath: file,
    startedAt: taskStart,
    finishedAt,
  };
}

function lastGenuineUserTs(events: RunEvent[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]!;
    if (ev.role === 'user' && ev.text && ev.ts && !isInjectedUserText(ev.text)) return ev.ts;
  }
  return undefined;
}

/** Last genuine (human-typed) user message — the task that kicked off the latest turn. */
export function deriveTaskText(events: RunEvent[]): string {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]!;
    if (ev.role === 'user' && ev.text && !isInjectedUserText(ev.text)) {
      return ev.text.trim();
    }
  }
  return '';
}

/** The final assistant narration: assistant text emitted after the last genuine user message. */
export function deriveFinalSummary(events: RunEvent[]): string {
  let lastUser = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]!;
    if (ev.role === 'user' && ev.text && !isInjectedUserText(ev.text)) {
      lastUser = i;
      break;
    }
  }
  const texts: string[] = [];
  for (let i = Math.max(0, lastUser + 1); i < events.length; i++) {
    const ev = events[i]!;
    if (ev.role === 'assistant' && ev.text) texts.push(ev.text.trim());
  }
  // Fall back to the very last assistant text if the turn-window heuristic found nothing.
  if (!texts.length) {
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i]!;
      if (ev.role === 'assistant' && ev.text) {
        texts.push(ev.text.trim());
        break;
      }
    }
  }
  return texts.join('\n\n').trim();
}

function safeResolve(p: string): string {
  try {
    return resolve(p);
  } catch {
    return p;
  }
}

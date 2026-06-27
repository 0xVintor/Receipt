/**
 * Shared helpers for turning raw transcript lines into normalized RunEvent[].
 *
 * These are deliberately defensive: agent transcript formats drift, carry extra event
 * types, and occasionally emit malformed lines. Nothing in here may throw on bad input —
 * unknown shapes are skipped, never fatal (PRD §13).
 */
import type { RunEvent } from '../types.js';

/** Parse newline-delimited JSON, skipping any line that fails to parse. */
export function parseJsonl(raw: string): unknown[] {
  const out: unknown[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // tolerate truncated / malformed lines
    }
  }
  return out;
}

export function asString(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** Flatten a content value (string | block[] ) into plain text. */
export function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        if (b && typeof b === 'object') {
          const rec = b as Record<string, unknown>;
          if (rec.type === 'text' && typeof rec.text === 'string') return rec.text;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

const RESULT_TEXT_CAP = 20_000;

/** A normalized tool result keyed by tool_use_id. */
export interface ToolResult {
  text: string;
  isError: boolean;
  exitCode: number | null;
  durationMs?: number;
}

/**
 * Derive a tool result from the two places it can live in a Claude Code transcript:
 *  - the `tool_result` content block ({ content, is_error })
 *  - the richer top-level `toolUseResult` ({ stdout, stderr, interrupted, code, ... } | string)
 */
export function deriveToolResult(block: Record<string, unknown>, toolUseResult: unknown): ToolResult {
  const isError = block.is_error === true;

  // Prefer the rich object/string for the human-readable evidence text.
  let text = '';
  if (typeof toolUseResult === 'string') {
    text = toolUseResult;
  } else if (toolUseResult && typeof toolUseResult === 'object') {
    const r = toolUseResult as Record<string, unknown>;
    const parts = [r.stdout, r.stderr, r.result, r.content]
      .map((p) => (typeof p === 'string' ? p : p == null ? '' : asString(p)))
      .filter(Boolean);
    text = parts.join('\n') || asString(toolUseResult);
  }
  if (!text) text = contentToTextLoose(block.content);

  if (text.length > RESULT_TEXT_CAP) text = text.slice(0, RESULT_TEXT_CAP) + '\n…[truncated]';

  return {
    text,
    isError,
    exitCode: deriveExitCode(isError, text, toolUseResult),
    durationMs: numberOrUndefined(
      toolUseResult && typeof toolUseResult === 'object'
        ? (toolUseResult as Record<string, unknown>).durationMs
        : undefined,
    ),
  };
}

function contentToTextLoose(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        if (typeof b === 'string') return b;
        if (b && typeof b === 'object') {
          const rec = b as Record<string, unknown>;
          if (typeof rec.text === 'string') return rec.text;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return content == null ? '' : asString(content);
}

/**
 * Best-effort exit code:
 *   1. explicit numeric `code` on the rich result object (Bash)
 *   2. `is_error === false`  -> 0
 *   3. parse "Exit code N" out of the result text
 *   4. `is_error === true`   -> 1 (non-zero, exact value unknown)
 *   5. otherwise null (unknown)
 */
export function deriveExitCode(isError: boolean, text: string, toolUseResult: unknown): number | null {
  if (toolUseResult && typeof toolUseResult === 'object') {
    const code = (toolUseResult as Record<string, unknown>).code;
    if (typeof code === 'number' && Number.isFinite(code)) return code;
  }
  const m = /(?:^|\b)Exit code (\d+)/i.exec(text);
  if (m) return Number(m[1]);
  if (isError) return 1;
  return 0;
}

function numberOrUndefined(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * After a flat list of events is built (with tool_use events carrying toolUseId), attach the
 * matching tool results gathered into `results`.
 */
export function attachResults(events: RunEvent[], results: Map<string, ToolResult>): void {
  for (const ev of events) {
    if (ev.toolName && ev.toolUseId) {
      const r = results.get(ev.toolUseId);
      if (r) {
        ev.toolResult = r.text;
        ev.toolExitCode = r.exitCode;
        ev.isError = r.isError;
        if (r.durationMs != null) ev.durationMs = r.durationMs;
      }
    }
  }
}

const INJECTED_PREFIXES = [
  '<task-notification>',
  '<system-reminder>',
  '<command-name>',
  '<command-message>',
  '<command-args>',
  '<local-command-stdout>',
  '<local-command-stderr>',
  '<bash-input>',
  '<bash-stdout>',
  '<bash-stderr>',
  '<user-memory-input>',
  'Caveat:',
  '[Request interrupted',
  'This session is being continued from a previous',
  'API Error',
];

/** Heuristic: is this user text injected by the harness rather than typed by the human? */
export function isInjectedUserText(text: string): boolean {
  const t = text.trimStart();
  if (!t) return true;
  return INJECTED_PREFIXES.some((p) => t.startsWith(p));
}

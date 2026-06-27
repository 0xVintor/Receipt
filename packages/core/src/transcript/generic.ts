/**
 * Generic transcript normalizer shared by the Cursor / OpenClaw adapters (PRD §7).
 *
 * Cursor and OpenClaw export formats are less stable than Claude Code's, so rather than
 * hard-code a fragile schema we recognize the common shapes:
 *   - newline-delimited JSON OR a single JSON array/object
 *   - messages as { role, content } where content is a string or block array
 *   - assistant tool calls in either Anthropic ({type:'tool_use',name,input}) or
 *     OpenAI ({tool_calls:[{function:{name,arguments}}]}) form
 *   - tool results as {role:'tool'|'function', content} or {type:'tool_result', content}
 *
 * Everything is best-effort and defensive — unknown shapes are skipped, never fatal.
 */
import { readFileSync } from 'node:fs';
import type { AgentKind, Run, RunEvent } from '../types.js';
import { parseJsonl, contentToText, asString, isInjectedUserText } from './normalize.js';
import { deriveTaskText, deriveFinalSummary } from './claudeCode.js';

function loadRecords(raw: string): Record<string, unknown>[] {
  const jsonl = parseJsonl(raw) as Record<string, unknown>[];
  if (jsonl.length > 1) return jsonl;
  // Try a single JSON document (array, or object with a messages/conversation field).
  try {
    const doc = JSON.parse(raw);
    if (Array.isArray(doc)) return doc as Record<string, unknown>[];
    if (doc && typeof doc === 'object') {
      const o = doc as Record<string, unknown>;
      for (const key of ['messages', 'conversation', 'history', 'turns', 'events']) {
        if (Array.isArray(o[key])) return o[key] as Record<string, unknown>[];
      }
      return [o];
    }
  } catch {
    /* not a single JSON doc */
  }
  return jsonl;
}

export function loadGenericSession(file: string, agent: AgentKind, fallbackCwd: string): Run {
  const raw = readFileSync(file, 'utf8');
  const records = loadRecords(raw);
  const events: RunEvent[] = [];
  let projectPath = fallbackCwd;
  // A single-object export may carry the project path on the wrapper (workspace/cwd/projectPath).
  try {
    const doc = JSON.parse(raw) as Record<string, unknown>;
    if (doc && typeof doc === 'object' && !Array.isArray(doc)) {
      const w = doc.workspace ?? doc.cwd ?? doc.projectPath;
      if (typeof w === 'string' && w) projectPath = w;
    }
  } catch {
    /* jsonl or non-object — per-record cwd handling below still applies */
  }
  const resultsById = new Map<string, { text: string; isError: boolean }>();

  // First pass: collect tool results keyed by id where present.
  for (const rec of records) {
    if (!rec || typeof rec !== 'object') continue;
    const cwd = rec.cwd ?? rec.workspace ?? rec.projectPath;
    if (typeof cwd === 'string' && cwd) projectPath = cwd;
    const blocks = messageBlocks(rec);
    for (const b of blocks) {
      if (b.type === 'tool_result') {
        const id = (b.tool_use_id as string) ?? (b.id as string) ?? '';
        if (id) resultsById.set(id, { text: contentToTextLoose(b.content), isError: b.is_error === true });
      }
    }
  }

  for (const rec of records) {
    if (!rec || typeof rec !== 'object') continue;
    const role = normalizeRole(rec);
    const ts = typeof rec.timestamp === 'string' ? rec.timestamp : (rec.ts as string | undefined);

    // OpenAI-style top-level tool_calls
    if (Array.isArray(rec.tool_calls)) {
      for (const call of rec.tool_calls as Record<string, unknown>[]) {
        const fn = (call.function as Record<string, unknown>) ?? call;
        events.push({
          role: 'assistant',
          toolName: asString(fn.name),
          toolInput: parseArgs(fn.arguments ?? fn.input),
          toolUseId: typeof call.id === 'string' ? call.id : undefined,
          ts,
        });
      }
    }

    const blocks = messageBlocks(rec);
    if (blocks.length) {
      for (const b of blocks) {
        if (b.type === 'text' && typeof b.text === 'string') {
          events.push({ role, text: b.text, ts });
        } else if (b.type === 'tool_use') {
          const id = typeof b.id === 'string' ? b.id : undefined;
          const res = id ? resultsById.get(id) : undefined;
          events.push({
            role: 'assistant',
            toolName: asString(b.name),
            toolInput: (b.input as Record<string, unknown>) ?? {},
            toolUseId: id,
            toolResult: res?.text,
            isError: res?.isError,
            toolExitCode: res ? (res.isError ? 1 : 0) : undefined,
            ts,
          });
        }
        // tool_result blocks already harvested in the first pass
      }
    } else {
      const text = contentToText(rec.content) || (typeof rec.text === 'string' ? rec.text : '');
      if (text) events.push({ role, text, ts });
    }
  }

  return {
    agent,
    projectPath,
    taskText: deriveTaskText(events),
    finalSummary: deriveFinalSummary(events),
    events,
    transcriptPath: file,
  };
}

function messageBlocks(rec: Record<string, unknown>): Record<string, unknown>[] {
  const msg = (rec.message as Record<string, unknown>) ?? rec;
  const content = msg.content;
  if (Array.isArray(content)) return content as Record<string, unknown>[];
  return [];
}

function normalizeRole(rec: Record<string, unknown>): 'user' | 'assistant' | 'system' {
  const msg = (rec.message as Record<string, unknown>) ?? rec;
  const r = (msg.role ?? rec.role ?? rec.type) as string | undefined;
  if (r === 'assistant' || r === 'ai' || r === 'model') return 'assistant';
  if (r === 'system') return 'system';
  return 'user';
}

function parseArgs(v: unknown): Record<string, unknown> {
  if (v && typeof v === 'object') return v as Record<string, unknown>;
  if (typeof v === 'string') {
    try {
      const o = JSON.parse(v);
      return o && typeof o === 'object' ? (o as Record<string, unknown>) : { raw: v };
    } catch {
      return { raw: v };
    }
  }
  return {};
}

function contentToTextLoose(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (typeof b === 'string' ? b : contentToText([b])))
      .filter(Boolean)
      .join('\n');
  }
  return content == null ? '' : asString(content);
}

export { isInjectedUserText };

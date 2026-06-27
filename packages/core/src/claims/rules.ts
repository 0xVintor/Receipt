/**
 * Deterministic claim extraction from tool_use events (PRD §6.2).
 *
 * No AI. We map structured tool calls to typed claims:
 *   Write/Edit/MultiEdit/NotebookEdit  -> file_change   (target = file path)
 *   Bash `npm|pnpm|yarn|bun add|install <pkg>` -> package_install (one per pkg)
 *   Bash test runner                   -> test_pass
 *   Bash build command                 -> build
 *   any other Bash                     -> command_run   (target = the command)
 *
 * The command classification tables are exported and extensible.
 */
import { nanoid } from 'nanoid';
import type { Claim, ClaimType, RunEvent } from '../types.js';

/** Tool names (across agents) that mean "the agent wrote to a file". */
export const FILE_WRITE_TOOLS = new Set([
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'create_file',
  'edit_file',
  'str_replace_editor',
  'str_replace_based_edit_tool',
  'apply_patch',
]);

export const TEST_PATTERNS: RegExp[] = [
  /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test(?:s)?\b/i,
  /\bnpx\s+(?:vitest|jest|playwright|mocha|ava)\b/i,
  /\b(?:vitest|jest|mocha|ava)\b/i,
  /\bplaywright\s+test\b/i,
  /\bpytest\b/i,
  /\bpython\s+-m\s+(?:pytest|unittest)\b/i,
  /\bgo\s+test\b/i,
  /\bcargo\s+test\b/i,
  /\bphpunit\b/i,
  /\brspec\b/i,
  /\bgradle(?:w)?\s+test\b/i,
  /\bmvn\s+test\b/i,
  /\brake\s+test\b/i,
];

export const BUILD_PATTERNS: RegExp[] = [
  /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?build\b/i,
  /\bnpx\s+tsc\b/i,
  /(?:^|\s|&&|;)tsc\b/i,
  /\bnext\s+build\b/i,
  /\bvite\s+build\b/i,
  /\bwebpack\b/i,
  /\brollup\b/i,
  /\besbuild\b/i,
  /\bcargo\s+build\b/i,
  /\bgo\s+build\b/i,
  /\bgradle(?:w)?\s+(?:build|assemble)\b/i,
  /\bmvn\s+(?:package|compile|install)\b/i,
  /\bmake\b(?!\s+(?:test|check))/i,
];

const INSTALL_RE = /^(npm|pnpm|yarn|bun)\s+(add|install|i)\b(.*)$/i;
const INSTALL_FILTER_FLAGS = new Set(['add', 'install', 'i']);
// A plausible npm package token: optional @scope/, name, optional @version-range.
const PKG_NAME_RE = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(?:@[A-Za-z0-9._^~><=*\- |]+)?$/i;
// Shell metacharacters that mean "the package list has ended" (redirection, pipe, subshell…).
const SHELL_BREAK = /[|&;<>(){}$`"']/;

/** Split a shell command on common separators so we can classify each segment. */
export function splitSegments(cmd: string): string[] {
  return cmd
    .split(/&&|\|\||;|\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Strip a leading `cd "…" &&` so detection sees the real command. */
function stripLeadingCd(seg: string): string {
  return seg.replace(/^cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*$/i, '').trim();
}

export interface ParsedPackage {
  name: string; // canonical name for lookups (scope preserved, version stripped)
  spec: string; // original token e.g. zod@3.23
}

/** Extract explicitly-installed packages from a (possibly chained) bash command. */
export function extractInstalledPackages(cmd: string): ParsedPackage[] {
  const out: ParsedPackage[] = [];
  for (const segRaw of splitSegments(cmd)) {
    const seg = stripLeadingCd(segRaw) || segRaw;
    const m = INSTALL_RE.exec(seg);
    if (!m) continue;
    const rest = (m[3] ?? '').trim();
    if (!rest) continue; // bare `npm install` (all deps) is not a specific-package claim
    for (const token of rest.split(/\s+/)) {
      if (!token) continue;
      if (SHELL_BREAK.test(token)) break; // redirection/pipe — package list is over
      if (token.startsWith('-')) continue; // flag
      if (INSTALL_FILTER_FLAGS.has(token.toLowerCase())) continue;
      if (token.includes('=')) continue; // env-style or flag value
      const name = canonicalPackageName(token);
      if (!PKG_NAME_RE.test(token) && !PKG_NAME_RE.test(name)) continue; // not a package name
      out.push({ name, spec: token });
    }
  }
  return out;
}

export function canonicalPackageName(token: string): string {
  if (token.startsWith('@')) {
    // @scope/name@version -> @scope/name
    const slash = token.indexOf('/');
    if (slash === -1) return token;
    const at = token.indexOf('@', slash);
    return at === -1 ? token : token.slice(0, at);
  }
  const at = token.indexOf('@');
  return at <= 0 ? token : token.slice(0, at);
}

export function isTestCommand(cmd: string): boolean {
  return TEST_PATTERNS.some((re) => re.test(cmd));
}

export function isBuildCommand(cmd: string): boolean {
  return BUILD_PATTERNS.some((re) => re.test(cmd));
}

function newClaim(type: ClaimType, rawText: string, target: string | undefined): Claim {
  return { id: nanoid(10), type, rawText, target, source: 'trace' };
}

function shortPath(p: string): string {
  // keep the last 3 path segments for readability
  const parts = p.split('/').filter(Boolean);
  return parts.length <= 3 ? p : '.../' + parts.slice(-3).join('/');
}

/** Map a single tool_use event to zero or more claims. */
export function claimsFromEvent(ev: RunEvent): Claim[] {
  if (!ev.toolName) return [];
  const name = ev.toolName;
  const input = ev.toolInput ?? {};

  if (FILE_WRITE_TOOLS.has(name)) {
    const path =
      (input.file_path as string) ||
      (input.filePath as string) ||
      (input.path as string) ||
      (input.notebook_path as string) ||
      '';
    if (!path) return [];
    const verb = name === 'Write' || name === 'create_file' ? 'wrote' : 'edited';
    return [newClaim('file_change', `${verb} ${shortPath(path)}`, path)];
  }

  if (name === 'Bash' || name === 'shell' || name === 'run_terminal_cmd' || name === 'terminal') {
    const cmd = ((input.command as string) || (input.cmd as string) || (input.script as string) || '').trim();
    if (!cmd) return [];
    const claims: Claim[] = [];

    const pkgs = extractInstalledPackages(cmd);
    for (const pkg of pkgs) {
      claims.push(newClaim('package_install', `installed ${pkg.spec}`, pkg.name));
    }
    if (isTestCommand(cmd)) {
      claims.push(newClaim('test_pass', `ran tests: \`${oneLine(cmd)}\``, cmd));
    }
    if (isBuildCommand(cmd)) {
      claims.push(newClaim('build', `built: \`${oneLine(cmd)}\``, cmd));
    }
    if (!claims.length) {
      claims.push(newClaim('command_run', `ran \`${oneLine(cmd)}\``, cmd));
    }
    return claims;
  }

  return [];
}

function oneLine(cmd: string): string {
  const c = cmd.replace(/\s+/g, ' ').trim();
  return c.length > 80 ? c.slice(0, 77) + '…' : c;
}

/** Extract all deterministic (trace) claims from a run's events, de-duplicated by (type,target). */
export function extractRuleClaims(events: RunEvent[]): Claim[] {
  const seen = new Set<string>();
  const out: Claim[] = [];
  for (const ev of events) {
    for (const claim of claimsFromEvent(ev)) {
      const key = `${claim.type}::${claim.target ?? claim.rawText}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(claim);
    }
  }
  return out;
}

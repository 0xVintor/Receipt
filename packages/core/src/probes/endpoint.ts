/**
 * endpoint probe (PRD §6.4, Phase 2b): parse method/url/expected status from the claim; if a
 * server is reachable (already running, or started via --start-cmd) hit it and assert the
 * status; otherwise unverifiable. Read-only HTTP; safe GET/HEAD only unless the claim is explicit.
 */
import type { Claim, ProbeResult } from '../types.js';
import { ok, type Probe, type ProbeContext } from './types.js';

export const endpointProbe: Probe = {
  type: 'endpoint',
  async run(claim: Claim, ctx: ProbeContext): Promise<ProbeResult> {
    try {
      const spec = parseEndpoint(`${claim.target ?? ''} ${claim.rawText ?? ''}`);
      if (!spec.url) return ok('unverifiable', 'no URL found in claim', 'endpoint');

      // SSRF guard: a claim's URL is untrusted input. By default only probe loopback hosts
      // (the common "my dev server returns 200" case). Non-loopback hosts are only probed when
      // the user explicitly started a server via --start-cmd.
      if (!isLoopback(spec.url) && !ctx.opts.startCmd) {
        return ok('unverifiable', `non-local endpoint not probed (SSRF guard): ${hostOf(spec.url)}`, 'endpoint');
      }

      // If a start command is provided, bring the server up briefly.
      let serverStarted: { kill: () => void } | null = null;
      if (ctx.opts.startCmd) {
        serverStarted = await startServer(ctx.opts.startCmd, ctx.project.root);
        await waitForReachable(spec.url, 15000);
      }

      try {
        const res = await fetchWithTimeout(spec.url, spec.method, 8000);
        if (res == null) {
          return ok('unverifiable', `no server responding at ${spec.url}`, 'endpoint');
        }
        if (spec.expectedStatus != null) {
          return res.status === spec.expectedStatus
            ? ok('verified', `${spec.method} ${spec.url} → ${res.status}`, 'endpoint')
            : ok('failed', `expected ${spec.expectedStatus}, got ${res.status}`, 'endpoint');
        }
        return res.status >= 200 && res.status < 400
          ? ok('verified', `${spec.method} ${spec.url} → ${res.status}`, 'endpoint')
          : ok('failed', `${spec.method} ${spec.url} → ${res.status}`, 'endpoint');
      } finally {
        serverStarted?.kill();
      }
    } catch (e) {
      return ok('unverifiable', `probe error: ${errMsg(e)}`, 'endpoint');
    }
  },
};

interface EndpointSpec {
  url: string;
  method: string;
  expectedStatus: number | null;
}

export function parseEndpoint(text: string): EndpointSpec {
  const urlMatch = /\bhttps?:\/\/[^\s"'`)<>]+/i.exec(text);
  let url = urlMatch ? urlMatch[0].replace(/[.,;:]$/, '') : '';
  // also support "/api/foo returns 200" with an implicit localhost
  if (!url) {
    const path = /(?:^|\s)(\/[A-Za-z0-9_\-/]+)/.exec(text);
    if (path && /\b(endpoint|route|returns?|GET|POST|PUT|DELETE|api)\b/i.test(text)) {
      url = `http://localhost:3000${path[1]}`;
    }
  }
  const methodMatch = /\b(GET|POST|PUT|DELETE|PATCH|HEAD)\b/i.exec(text);
  const method = methodMatch ? methodMatch[1]!.toUpperCase() : 'GET';
  const statusMatch = /\b([1-5]\d\d)\b/.exec(text);
  const expectedStatus = statusMatch ? Number(statusMatch[1]) : null;
  return { url, method, expectedStatus };
}

async function fetchWithTimeout(
  url: string,
  method: string,
  ms: number,
): Promise<{ status: number } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const safeMethod = method === 'GET' || method === 'HEAD' ? method : 'GET';
    const res = await fetch(url, { method: safeMethod, signal: ctrl.signal });
    return { status: res.status };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForReachable(url: string, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await fetchWithTimeout(url, 'GET', 2000)) return;
    await sleep(500);
  }
}

async function startServer(cmd: string, cwd: string): Promise<{ kill: () => void }> {
  // Fire-and-forget; we kill it in finally. runShell would block, so we use a detached child.
  const { spawn } = await import('node:child_process');
  const child = spawn('sh', ['-c', cmd], { cwd, detached: true, stdio: 'ignore' });
  return {
    kill: () => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGTERM');
      } catch {
        try {
          child.kill('SIGTERM');
        } catch {
          /* ignore */
        }
      }
    },
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '(unparseable)';
  }
}

/** Only loopback hosts are probed by default (SSRF guard). */
export function isLoopback(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return false;
  }
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') return true;
  if (host.startsWith('127.')) return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

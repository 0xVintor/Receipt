/**
 * Run orchestration (PRD §3 run.ts): read transcript -> extract claims -> run probes -> verdict.
 *
 * This is the single entry the CLI calls. It is fully deterministic unless a key is configured
 * AND --no-ai is absent, in which case the optional AI layer may add prose claims / a nicer
 * one-liner. Persistence to the local store is best-effort and never affects the verdict.
 */
import { nanoid } from 'nanoid';
import type { Run, RunOptions, Verdict, VerifiedClaim } from './types.js';
import { detectAndLoad, NoSessionError } from './transcript/index.js';
import { buildGitContext, repoRelative, hashAtBase, type GitInfo } from './git/index.js';
import { detectProject } from './project/detect.js';
import { extractClaims } from './claims/extract.js';
import { verifyClaims } from './probes/index.js';
import type { ProbeContext } from './probes/types.js';
import { synthesizeVerdict } from './verdict/synthesize.js';
import { captureSnapshots, type SnapshotRecord } from './regression/index.js';
import { openStore } from './store/db.js';

export interface RunResult {
  run: Run;
  verdict: Verdict;
  snapshots?: SnapshotRecord[];
}

export async function verifyRun(opts: RunOptions = {}): Promise<RunResult> {
  const cwd = opts.cwd ?? process.cwd();

  // 1) read transcript -> Run  (throws NoSessionError when nothing to verify)
  const run = await detectAndLoad(opts);

  // 2) project + git context (nearest repo root from cwd; §13 monorepo/nested-git).
  // sessionSince = first event timestamp, so edits the agent COMMITTED during the session are
  // attributed correctly (otherwise committed-and-pushed work would falsely read as unchanged).
  const sessionSince = run.events.find((e) => e.ts)?.ts ?? run.startedAt;
  const gitInfo = await buildGitContext(cwd, { sinceRef: opts.since, sessionSince });
  const project = detectProject(gitInfo.root);

  // 3) claims (rules always; AI only if available and not --no-ai)
  const claims = await extractClaims(run, opts);

  // 4) probes
  const ctx: ProbeContext = {
    projectPath: gitInfo.root,
    gitInfo,
    project,
    opts,
    events: run.events,
    timeoutMs: (opts.timeoutSec ?? 120) * 1000,
    cache: new Map(),
  };
  const verified = await verifyClaims(claims, ctx);

  // 5) optional characterization snapshots (opt-in, writes only under .receipt/)
  let snapshots: SnapshotRecord[] | undefined;
  if (opts.snapshot && gitInfo.isRepo) {
    try {
      snapshots = captureSnapshots(gitInfo, project);
    } catch {
      /* snapshots are best-effort */
    }
  }

  // 6) verdict
  const verdict = await synthesizeVerdict(verified, opts);
  verdict.agent = run.agent;
  verdict.taskText = run.taskText;
  verdict.projectPath = run.projectPath;
  verdict.durationMs = runDuration(run);
  const runId = nanoid(12);
  verdict.runId = runId;

  // 7) persist (best-effort; never affects the result or throws to the caller)
  if (opts.persist !== false) {
    try {
      const store = openStore();
      const baselines = await collectBaselines(verified, gitInfo);
      store.saveRun({
        runId,
        run,
        verdict,
        baselines,
        snapshots: snapshots?.map((s) => ({ path: s.path, outputHash: s.outputHash })),
      });
    } catch {
      /* ignore persistence errors */
    }
  }

  return { run, verdict, snapshots };
}

function runDuration(run: Run): number | undefined {
  if (run.startedAt && run.finishedAt) {
    const d = Date.parse(run.finishedAt) - Date.parse(run.startedAt);
    return Number.isFinite(d) && d >= 0 ? d : undefined;
  }
  return undefined;
}

async function collectBaselines(
  claims: VerifiedClaim[],
  git: GitInfo,
): Promise<{ filePath: string; preHash: string }[]> {
  if (!git.isRepo) return [];
  const out: { filePath: string; preHash: string }[] = [];
  for (const c of claims) {
    if (c.type !== 'file_change' || !c.target) continue;
    const rel = repoRelative(git, c.target);
    if (!rel) continue;
    const pre = await hashAtBase(git, rel);
    out.push({ filePath: rel, preHash: pre ?? '(new)' });
  }
  return out;
}

export { NoSessionError };

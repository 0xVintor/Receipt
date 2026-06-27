/**
 * `receipt check` (PRD §7). Reads the latest session, verifies claims, prints a receipt.
 * Exit codes: 0 pass, 1 warn, 2 fail (so CI can gate).
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import {
  verifyRun,
  NoSessionError,
  type AgentKind,
  type RunOptions,
  type RunResult,
} from '@receipt/core';
import { renderReceipt, renderQuiet, renderMarkdown } from '../render/receipt.js';

export interface CheckCliOptions {
  ai?: boolean; // commander: --no-ai => ai:false
  json?: boolean;
  session?: string;
  agent?: string;
  since?: string;
  timeout?: string;
  snapshot?: boolean;
  quiet?: boolean;
  tests?: boolean; // commander: --no-tests => tests:false
  retries?: string;
  startCmd?: string;
  dbUrl?: string;
  cwd?: string;
  store?: boolean; // commander: --no-store => store:false
}

export async function checkCommand(cli: CheckCliOptions): Promise<number> {
  const opts: RunOptions = {
    session: cli.session,
    agent: cli.agent as AgentKind | undefined,
    noAi: cli.ai === false,
    noTests: cli.tests === false,
    timeoutSec: numberOpt(cli.timeout),
    snapshot: !!cli.snapshot,
    since: cli.since,
    retries: numberOpt(cli.retries),
    startCmd: cli.startCmd,
    dbUrl: cli.dbUrl,
    cwd: cli.cwd,
    persist: cli.store !== false,
  };

  let result: RunResult;
  try {
    result = await verifyRun(opts);
  } catch (e) {
    if (e instanceof NoSessionError) {
      if (cli.json) {
        process.stdout.write(
          JSON.stringify({
            overall: 'pass',
            summary: e.message,
            claims: [],
            counts: { verified: 0, failed: 0, unverifiable: 0 },
          }) + '\n',
        );
      } else if (!cli.quiet) {
        process.stderr.write(chalk.dim(`${e.message}\n`));
      }
      return 0; // nothing to verify is not a failure
    }
    throw e;
  }

  const { verdict } = result;

  if (cli.json) {
    process.stdout.write(JSON.stringify(verdict, null, 2) + '\n');
  } else if (cli.quiet) {
    process.stdout.write(renderQuiet(verdict) + '\n');
  } else {
    process.stdout.write('\n' + renderReceipt(verdict) + '\n\n');
  }

  if (!cli.json) {
    try {
      writeMarkdownCopy(result);
    } catch {
      /* best-effort */
    }
  }

  return exitCodeFor(verdict.overall);
}

function writeMarkdownCopy(result: RunResult): void {
  const root = result.verdict.projectPath || result.run.projectPath || process.cwd();
  const dir = join(root, '.receipt', 'receipts');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  writeFileSync(join(dir, `${stamp}.md`), renderMarkdown(result.verdict));
}

function exitCodeFor(overall: string): number {
  if (overall === 'fail') return 2;
  if (overall === 'warn') return 1;
  return 0;
}

function numberOpt(v?: string): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

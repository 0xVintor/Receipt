/**
 * `receipt show [id]` — re-render a stored receipt from local history (defaults to the latest).
 * Gives the CLI parity with the dashboard for inspecting a past run.
 */
import chalk from 'chalk';
import { openStore, templateSummary, type Verdict, type AgentKind } from '@receipt/core';
import { renderReceipt } from '../render/receipt.js';

export function showCommand(id: string | undefined, cli: { json?: boolean }): number {
  const store = openStore();

  let runId = id;
  if (!runId) {
    const latest = store.listRuns(1);
    runId = latest[0]?.id;
  }
  const data = runId ? store.getRun(runId) : null;
  if (!data) {
    console.error(chalk.red(id ? `No run found with id "${id}".` : 'No receipts in history yet.'));
    return 1;
  }

  const verdict: Verdict = {
    overall: data.run.overall as Verdict['overall'],
    summary: templateSummary(data.run.overall as Verdict['overall'], data.claims, data.run.counts),
    claims: data.claims,
    counts: data.run.counts,
    agent: data.run.agent as AgentKind,
    taskText: data.run.taskText,
    projectPath: data.run.projectPath,
    runId: data.run.id,
  };

  if (cli.json) {
    process.stdout.write(JSON.stringify(verdict, null, 2) + '\n');
    return 0;
  }
  process.stdout.write('\n' + renderReceipt(verdict) + '\n');
  process.stdout.write(chalk.dim(`  run ${data.run.id} · ${new Date(data.run.createdAt).toLocaleString()}\n\n`));
  return 0;
}

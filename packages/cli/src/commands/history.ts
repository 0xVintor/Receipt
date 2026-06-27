/**
 * `receipt history` (PRD §7): list recent receipts from the local SQLite store.
 */
import chalk from 'chalk';
import Table from 'cli-table3';
import { openStore, type SavedRun } from '@receipt/core';

export interface HistoryCliOptions {
  limit?: string;
  json?: boolean;
}

export function historyCommand(cli: HistoryCliOptions): number {
  const limit = cli.limit ? Math.max(1, Number(cli.limit) || 20) : 20;
  let runs: SavedRun[] = [];
  try {
    runs = openStore().listRuns(limit);
  } catch (e) {
    console.error(chalk.red(`Could not read history: ${e instanceof Error ? e.message : String(e)}`));
    return 1;
  }

  if (cli.json) {
    process.stdout.write(JSON.stringify(runs, null, 2) + '\n');
    return 0;
  }

  if (runs.length === 0) {
    console.log(chalk.dim('No receipts yet. Run `receipt check` after an agent finishes a task.'));
    return 0;
  }

  const table = new Table({
    head: ['when', 'verdict', '✓', '✗', '?', 'task'],
    style: { head: ['bold'] },
    colWidths: [22, 9, 4, 4, 4, 44],
    wordWrap: true,
  });

  for (const r of runs) {
    table.push([
      relativeTime(r.createdAt),
      colorOverall(r.overall),
      String(r.counts.verified),
      r.counts.failed ? chalk.red(String(r.counts.failed)) : '0',
      String(r.counts.unverifiable),
      truncate(r.taskText || '(no task)', 42),
    ]);
  }
  console.log(table.toString());
  return 0;
}

function colorOverall(o: string): string {
  if (o === 'pass') return chalk.green('pass');
  if (o === 'warn') return chalk.yellow('warn');
  if (o === 'fail') return chalk.red.bold('fail');
  return o;
}

function relativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

function truncate(s: string, n: number): string {
  const oneLine = s.replace(/\s+/g, ' ').trim();
  return oneLine.length > n ? oneLine.slice(0, n - 1) + '…' : oneLine;
}

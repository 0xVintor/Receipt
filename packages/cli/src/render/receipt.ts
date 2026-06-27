/**
 * Terminal + markdown rendering of a receipt (PRD §8). Screenshot-friendly: a header line,
 * the headline counts, one aligned row per claim, and a verdict line.
 */
import chalk from 'chalk';
import type { Overall, ProbeStatus, Verdict, VerifiedClaim } from '@receipt/core';

const ICON: Record<ProbeStatus, string> = {
  verified: '✓',
  failed: '✗',
  unverifiable: '?',
};

function colorIcon(status: ProbeStatus): string {
  const ch = `[${ICON[status]}]`;
  if (status === 'verified') return chalk.green(ch);
  if (status === 'failed') return chalk.red.bold(ch);
  return chalk.yellow(ch);
}

function colorStatus(status: ProbeStatus): string {
  if (status === 'verified') return chalk.green('verified');
  if (status === 'failed') return chalk.red.bold('FAILED');
  return chalk.yellow('unverifiable');
}

function overallColor(overall: Overall, s: string): string {
  if (overall === 'pass') return chalk.green.bold(s);
  if (overall === 'warn') return chalk.yellow.bold(s);
  return chalk.red.bold(s);
}

export function formatDuration(ms?: number): string {
  if (!ms || ms < 0) return '';
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m${String(s).padStart(2, '0')}s`;
}

// visible width ignoring ANSI codes
function vlen(s: string): number {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\[[0-9;]*m/g, '').length;
}

export function renderReceipt(verdict: Verdict): string {
  const lines: string[] = [];
  const dur = formatDuration(verdict.durationMs);
  const task = verdict.taskText ? truncate(verdict.taskText.replace(/\s+/g, ' '), 70) : '(no task captured)';

  // header
  lines.push(
    chalk.bold('RECEIPT') +
      chalk.dim(' · ') +
      `task: ${chalk.cyan(`"${task}"`)}` +
      (dur ? chalk.dim(` · ${dur}`) : '') +
      (verdict.agent ? chalk.dim(` · ${verdict.agent}`) : ''),
  );

  // counts
  const c = verdict.counts;
  const countLine =
    `CLAIMED ${chalk.bold(String(verdict.claims.length))} action${verdict.claims.length === 1 ? '' : 's'} — ` +
    `${chalk.green(`verified ${c.verified}`)}, ` +
    `${c.failed > 0 ? chalk.red.bold(`FAILED ${c.failed}`) : `failed ${c.failed}`}, ` +
    `${c.unverifiable > 0 ? chalk.yellow(`unverifiable ${c.unverifiable}`) : `unverifiable ${c.unverifiable}`}`;
  lines.push(countLine);
  lines.push('');

  // claim rows, left column aligned
  const left = verdict.claims.map((cl) => `${colorIcon(cl.status)} ${cl.rawText}`);
  const width = Math.min(Math.max(0, ...left.map(vlen)), 52);
  verdict.claims.forEach((cl, i) => {
    const l = left[i]!;
    const pad = ' '.repeat(Math.max(2, width - vlen(l) + 2));
    lines.push(`${l}${pad}${colorStatus(cl.status)} ${chalk.dim(`(${cl.evidence})`)}`);
  });
  if (verdict.claims.length === 0) {
    lines.push(chalk.dim('  (no verifiable claims found in this run)'));
  }
  lines.push('');

  // verdict
  const label = overallColor(verdict.overall, `VERDICT (${verdict.overall})`);
  lines.push(`${label}: ${verdict.summary}`);
  if (verdict.aiUsed) lines.push(chalk.dim('  (summary written by AI; all verification is deterministic)'));

  return lines.join('\n');
}

/** One-line output for hook use (`--quiet`). */
export function renderQuiet(verdict: Verdict): string {
  const c = verdict.counts;
  const tag = overallColor(verdict.overall, verdict.overall.toUpperCase());
  return `RECEIPT ${tag} · ${chalk.green(`${c.verified}✓`)} ${c.failed ? chalk.red(`${c.failed}✗`) : `${c.failed}✗`} ${c.unverifiable}? · ${verdict.summary}`;
}

/** Markdown copy saved under .receipt/receipts/ (PRD §8). */
export function renderMarkdown(verdict: Verdict): string {
  const c = verdict.counts;
  const rows = verdict.claims
    .map((cl: VerifiedClaim) => `| ${ICON[cl.status]} | ${md(cl.rawText)} | ${cl.status} | ${md(cl.evidence)} |`)
    .join('\n');
  return [
    `# Receipt — ${verdict.overall.toUpperCase()}`,
    '',
    `- **Task:** ${verdict.taskText ?? '(none)'}`,
    `- **Agent:** ${verdict.agent ?? 'unknown'}`,
    `- **Claimed:** ${verdict.claims.length} · verified ${c.verified} · failed ${c.failed} · unverifiable ${c.unverifiable}`,
    verdict.durationMs ? `- **Duration:** ${formatDuration(verdict.durationMs)}` : '',
    '',
    '| | Claim | Status | Evidence |',
    '| - | ----- | ------ | -------- |',
    rows || '| | (no claims) | | |',
    '',
    `**Verdict (${verdict.overall}):** ${verdict.summary}`,
    '',
  ]
    .filter((l) => l !== '')
    .join('\n');
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
function md(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

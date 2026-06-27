/**
 * `receipt init` (PRD §7.1): install a Claude Code **Stop** hook that auto-runs
 * `receipt check --quiet` when an agent turn finishes.
 *
 * Verified against the real settings format (~/.claude/settings.json):
 *   { "hooks": { "Stop": [ { "hooks": [ { "type": "command", "command": "…" } ] } ] } }
 *
 * Idempotent (won't duplicate), reversible (--uninstall), and safe: if the settings file is
 * present but unparseable, we write NOTHING and print manual instructions.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import chalk from 'chalk';

const DEFAULT_COMMAND = 'npx receipt check --quiet';

export interface InitCliOptions {
  global?: boolean;
  local?: boolean;
  command?: string;
  uninstall?: boolean;
  cwd?: string;
}

function settingsPath(cli: InitCliOptions): string {
  if (cli.global) return join(homedir(), '.claude', 'settings.json');
  const root = cli.cwd ?? process.cwd();
  return join(root, '.claude', cli.local ? 'settings.local.json' : 'settings.json');
}

type Settings = Record<string, unknown>;
interface HookEntry {
  type?: string;
  command?: string;
}
interface HookGroup {
  matcher?: string;
  hooks?: HookEntry[];
}

export function initCommand(cli: InitCliOptions): number {
  const path = settingsPath(cli);
  const command = cli.command ?? DEFAULT_COMMAND;

  let settings: Settings = {};
  if (existsSync(path)) {
    try {
      settings = JSON.parse(readFileSync(path, 'utf8')) as Settings;
      if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) {
        throw new Error('not an object');
      }
    } catch {
      printManual(path, command);
      return 1;
    }
  }

  const hooks = (settings.hooks ??= {}) as Record<string, HookGroup[]>;
  const stop = (hooks.Stop ??= []) as HookGroup[];

  const has = stop.some((g) => (g.hooks ?? []).some((h) => (h.command ?? '').includes('receipt check')));

  if (cli.uninstall) {
    if (!has) {
      console.log(chalk.dim(`No Receipt hook found in ${path}. Nothing to remove.`));
      return 0;
    }
    hooks.Stop = stop
      .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !(h.command ?? '').includes('receipt check')) }))
      .filter((g) => (g.hooks ?? []).length > 0);
    if ((hooks.Stop as HookGroup[]).length === 0) delete hooks.Stop;
    save(path, settings);
    console.log(chalk.green('✓') + ` Removed the Receipt Stop hook from ${chalk.cyan(path)}`);
    return 0;
  }

  if (has) {
    console.log(chalk.green('✓') + ` Receipt hook already installed in ${chalk.cyan(path)} (no change).`);
    return 0;
  }

  stop.push({ hooks: [{ type: 'command', command }] });
  save(path, settings);

  console.log(chalk.green.bold('✓ Installed Receipt Stop hook'));
  console.log(`  file:    ${chalk.cyan(path)}`);
  console.log(`  command: ${chalk.cyan(command)}`);
  console.log(chalk.dim('  Claude Code will now run a receipt automatically when a turn finishes.'));
  console.log(chalk.dim(`  Undo with: receipt init --uninstall${cli.global ? ' --global' : cli.local ? ' --local' : ''}`));
  return 0;
}

function save(path: string, settings: Settings): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(settings, null, 2) + '\n');
}

function printManual(path: string, command: string): void {
  console.log(chalk.yellow(`Could not safely parse ${path}.`));
  console.log('Add this Stop hook manually to your Claude Code settings:');
  console.log(
    chalk.dim(
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command }] }] } }, null, 2),
    ),
  );
}

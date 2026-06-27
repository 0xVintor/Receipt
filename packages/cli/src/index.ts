/**
 * `receipt` CLI entry (PRD §7). Commander setup + exit-code plumbing.
 *
 * `receipt` with no subcommand (or with only options) defaults to `check`, so
 * `npx receipt`, `npx receipt check`, and `npx receipt --json` all work.
 */
import { Command } from 'commander';
import chalk from 'chalk';
import { checkCommand } from './commands/check.js';
import { initCommand } from './commands/init.js';
import { historyCommand } from './commands/history.js';
import { showCommand } from './commands/show.js';
import { configSetKey, configSetProvider, configShow } from './commands/config.js';

const VERSION = '0.1.0';
const KNOWN = new Set(['check', 'init', 'config', 'history', 'show', 'help']);

export async function run(argv: string[] = process.argv): Promise<void> {
  const program = new Command();

  program
    .name('receipt')
    .description('Verify what an AI coding agent actually did vs. what it claimed.')
    .version(VERSION, '-v, --version');

  program
    .command('check', { isDefault: true })
    .description('Verify the latest agent session against reality (default command)')
    .option('--no-ai', 'deterministic only — no API key, no network, no cost')
    .option('--json', 'print machine-readable JSON (schema mirrors Verdict)')
    .option('--session <path>', 'explicit transcript file')
    .option('--agent <kind>', 'claude-code | cursor | openclaw (auto-detect default)')
    .option('--since <gitref>', 'bound the task window / diff baseline')
    .option('--timeout <sec>', 'per-probe timeout in seconds (default 120)')
    .option('--snapshot', 'capture characterization snapshots for untested touched files')
    .option('--quiet', 'minimal one-line output (for hook use)')
    .option('--no-tests', 'skip re-running tests / build (faster)')
    .option('--retries <n>', 'mark a test flaky if results differ across n+1 runs')
    .option('--start-cmd <cmd>', 'dev-server start command (endpoint probe)')
    .option('--db-url <url>', 'database URL for the migration probe (sqlite supported)')
    .option('--cwd <path>', 'project directory (default: current dir)')
    .option('--no-store', 'do not persist this run to local history')
    .action(async (opts) => {
      process.exitCode = await checkCommand(opts);
    });

  program
    .command('init')
    .description('Install a Claude Code Stop hook to auto-run `receipt check --quiet`')
    .option('--global', 'write to ~/.claude/settings.json (default: project .claude/settings.json)')
    .option('--local', 'write to project .claude/settings.local.json (personal, untracked)')
    .option('--command <cmd>', 'override the hook command')
    .option('--cwd <path>', 'project directory (default: current dir)')
    .option('--uninstall', 'remove the Receipt hook')
    .action((opts) => {
      process.exitCode = initCommand(opts);
    });

  program
    .command('history')
    .description('List recent receipts from local history')
    .option('--limit <n>', 'how many to show (default 20)')
    .option('--json', 'print machine-readable JSON')
    .action((opts) => {
      process.exitCode = historyCommand(opts);
    });

  program
    .command('show [id]')
    .description('Re-render a stored receipt (defaults to the most recent run)')
    .option('--json', 'print machine-readable JSON')
    .action((id, opts) => {
      process.exitCode = showCommand(id, opts);
    });

  const config = program.command('config').description('Manage the optional AI provider / key');
  config
    .command('set-key [key]')
    .description('Store a provider API key (env vars still override it)')
    .option('--provider <p>', 'also set the provider: google | anthropic | openai')
    .action(async (key, opts) => {
      process.exitCode = await configSetKey(key, opts);
    });
  config
    .command('set-provider <provider>')
    .description('Set the provider (google | anthropic | openai)')
    .option('--model <id>', 'model id (defaults to a cheap model for the provider)')
    .action((provider, opts) => {
      process.exitCode = configSetProvider(provider, opts);
    });
  config
    .command('show')
    .description('Show effective config (key masked)')
    .action(() => {
      process.exitCode = configShow();
    });

  program.configureOutput({
    outputError: (str, write) => write(chalk.red(str)),
  });

  await program.parseAsync(injectDefault(argv));
}

/** Make `receipt` / `receipt --json` behave as `receipt check …`. */
function injectDefault(argv: string[]): string[] {
  const rest = argv.slice(2);
  const first = rest[0];
  if (!first) return argv; // commander runs the default (check) with no opts
  if (first === '-v' || first === '--version' || first === '-h' || first === '--help') return argv;
  if (first.startsWith('-')) return [argv[0]!, argv[1]!, 'check', ...rest];
  if (!KNOWN.has(first)) return [argv[0]!, argv[1]!, 'check', ...rest];
  return argv;
}

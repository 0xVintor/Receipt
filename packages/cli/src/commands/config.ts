/**
 * `receipt config` (PRD §7). Manage the optional LLM provider/key for the AI layer.
 * The key is written to ~/.receipt/config.json with 0600 perms. Env vars always override it,
 * so CI can stay keyless. The deterministic path never needs any of this.
 */
import chalk from 'chalk';
import { writeConfig, readConfig, resolveLlm, configPath, defaultModel, type Provider } from '@receipt/core';

export async function configSetKey(keyArg: string | undefined, opts: { provider?: string }): Promise<number> {
  const key = keyArg ?? (await readStdin());
  if (!key) {
    console.error(chalk.red('No key provided.'));
    console.error(chalk.dim('Usage: receipt config set-key <API_KEY>   (or pipe it: echo $KEY | receipt config set-key)'));
    return 1;
  }
  const patch: { apiKey: string; provider?: Provider } = { apiKey: key.trim() };
  if (opts.provider) patch.provider = opts.provider as Provider;
  writeConfig(patch);
  console.log(chalk.green('✓') + ` Saved API key to ${chalk.cyan(configPath())} ${chalk.dim('(0600)')}`);
  const r = resolveLlm();
  console.log(chalk.dim(`  provider: ${r.provider} · model: ${r.model}`));
  return 0;
}

export function configSetProvider(provider: string, opts: { model?: string }): number {
  const valid: Provider[] = ['google', 'anthropic', 'openai'];
  if (!valid.includes(provider as Provider)) {
    console.error(chalk.red(`Invalid provider "${provider}". Choose: ${valid.join(', ')}`));
    return 1;
  }
  const p = provider as Provider;
  writeConfig({ provider: p, model: opts.model ?? defaultModel(p) });
  const r = resolveLlm();
  console.log(chalk.green('✓') + ` Provider set to ${chalk.cyan(r.provider)} · model ${chalk.cyan(r.model)}`);
  if (!r.enabled) console.log(chalk.dim('  No key configured yet — run: receipt config set-key <API_KEY>'));
  return 0;
}

export function configShow(): number {
  const file = readConfig();
  const r = resolveLlm();
  console.log(chalk.bold('Receipt config') + chalk.dim(` (${configPath()})`));
  console.log(`  provider: ${chalk.cyan(r.provider)}`);
  console.log(`  model:    ${chalk.cyan(r.model)}`);
  console.log(`  key:      ${r.apiKey ? chalk.green('configured ' + mask(r.apiKey)) : chalk.yellow('not set (keyless mode)')}`);
  console.log(chalk.dim(`  source:   ${file.apiKey ? 'config.json' : r.apiKey ? 'environment' : 'none'}`));
  return 0;
}

function mask(k: string): string {
  if (k.length <= 8) return '****';
  return k.slice(0, 4) + '…' + k.slice(-4);
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(''));
  });
}

/**
 * Receipt configuration (PRD §6.9, §7 config commands).
 *
 * Stored at ~/.receipt/config.json with 0600 perms. Environment variables always override
 * the file so CI can stay keyless or inject a key without touching disk.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { z } from 'zod';

export type Provider = 'google' | 'anthropic' | 'openai';

export const ConfigSchema = z.object({
  provider: z.enum(['google', 'anthropic', 'openai']).optional(),
  model: z.string().optional(),
  apiKey: z.string().optional(),
});
export type ReceiptConfig = z.infer<typeof ConfigSchema>;

export function receiptHome(): string {
  return process.env.RECEIPT_HOME || join(homedir(), '.receipt');
}

export function configPath(): string {
  return join(receiptHome(), 'config.json');
}

export function readConfig(): ReceiptConfig {
  const path = configPath();
  if (!existsSync(path)) return {};
  try {
    const parsed = ConfigSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

export function writeConfig(patch: Partial<ReceiptConfig>): ReceiptConfig {
  const dir = receiptHome();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const next = { ...readConfig(), ...patch };
  const path = configPath();
  writeFileSync(path, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* best effort on platforms without chmod semantics */
  }
  return next;
}

export function defaultModel(provider: Provider): string {
  switch (provider) {
    case 'google':
      return 'gemini-2.0-flash-lite';
    case 'anthropic':
      return 'claude-haiku-4-5';
    case 'openai':
      return 'gpt-4o-mini';
  }
}

function providerKeyEnv(provider: Provider): string | undefined {
  switch (provider) {
    case 'google':
      return process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY;
    case 'anthropic':
      return process.env.ANTHROPIC_API_KEY;
    case 'openai':
      return process.env.OPENAI_API_KEY;
  }
}

export interface ResolvedLlm {
  provider: Provider;
  model: string;
  apiKey?: string;
  enabled: boolean; // a key is present
}

/** Merge env + file config into effective LLM settings. */
export function resolveLlm(): ResolvedLlm {
  const file = readConfig();
  const provider = (process.env.RECEIPT_PROVIDER as Provider) || file.provider || 'google';
  const model = process.env.RECEIPT_MODEL || file.model || defaultModel(provider);
  const apiKey = process.env.RECEIPT_API_KEY || providerKeyEnv(provider) || file.apiKey;
  return { provider, model, apiKey, enabled: !!apiKey };
}

export { dirname };

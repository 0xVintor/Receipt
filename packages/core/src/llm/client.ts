/**
 * Provider-agnostic LLM client (PRD §6.9).
 *
 * Wraps the Vercel AI SDK. Providers are imported lazily so the deterministic `--no-ai`
 * path never loads them and never touches the network. `complete()` NEVER throws — on any
 * error (missing key, bad provider, network, invalid JSON) it returns null and the caller
 * falls back to deterministic behavior.
 */
import { z } from 'zod';
import { resolveLlm, type Provider } from '../config.js';

export interface CompleteArgs<T> {
  system: string;
  prompt: string;
  schema?: z.ZodType<T>;
  maxTokens?: number;
}

/** Is the optional AI layer usable right now? */
export function isAiAvailable(opts?: { noAi?: boolean }): boolean {
  if (opts?.noAi) return false;
  return resolveLlm().enabled;
}

async function resolveModel(provider: Provider, model: string, apiKey: string): Promise<unknown> {
  switch (provider) {
    case 'google': {
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
      return createGoogleGenerativeAI({ apiKey })(model);
    }
    case 'anthropic': {
      const { createAnthropic } = await import('@ai-sdk/anthropic');
      return createAnthropic({ apiKey })(model);
    }
    case 'openai': {
      const { createOpenAI } = await import('@ai-sdk/openai');
      return createOpenAI({ apiKey })(model);
    }
  }
}

export async function complete<T = string>(args: CompleteArgs<T>): Promise<T | string | null> {
  const cfg = resolveLlm();
  if (!cfg.enabled || !cfg.apiKey) return null;

  try {
    const model = await resolveModel(cfg.provider, cfg.model, cfg.apiKey);
    const ai = await import('ai');

    if (args.schema) {
      const { object } = await ai.generateObject({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        model: model as any,
        schema: args.schema,
        system: args.system,
        prompt: args.prompt,
        maxRetries: 1,
      });
      return object as T;
    }

    const { text } = await ai.generateText({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      model: model as any,
      system: args.system,
      prompt: args.prompt,
      maxRetries: 1,
      maxTokens: args.maxTokens ?? 200,
    });
    return text;
  } catch {
    return null;
  }
}

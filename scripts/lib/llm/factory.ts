import type { LlmProvider, LlmProviderName } from './provider.js';
import { GeminiProvider } from './gemini-provider.js';
import { ClaudeCliProvider } from './claude-cli-provider.js';
import { FallbackLlmProvider } from './fallback-provider.js';

export interface ProviderSpec {
  provider: LlmProviderName;
  fallback?: LlmProviderName;
}

const VALID_PROVIDERS: readonly LlmProviderName[] = ['gemini', 'claude-cli'];

function assertValidProvider(name: string): asserts name is LlmProviderName {
  if (!(VALID_PROVIDERS as readonly string[]).includes(name)) {
    throw new Error(
      `Unknown LLM provider "${name}". Valid values: ${VALID_PROVIDERS.join(', ')}`
    );
  }
}

/**
 * Read the LLM provider selection from argv + env. CLI flags win over env.
 *
 * Recognized inputs:
 *   --llm <gemini|claude-cli>         primary provider
 *   --fallback <gemini|claude-cli>    fallback on quota errors
 *   LLM_PROVIDER=<name>               same as --llm
 *   LLM_FALLBACK=<name>               same as --fallback
 */
export function resolveProviderSpecFromArgs(
  args: string[],
  env: NodeJS.ProcessEnv = process.env
): ProviderSpec {
  const flagValue = (flag: string): string | undefined => {
    for (let i = 0; i < args.length; i++) {
      if (args[i] === flag && args[i + 1]) {
        return args[i + 1];
      }
    }
    return undefined;
  };

  const rawPrimary = flagValue('--llm') ?? env.LLM_PROVIDER ?? 'gemini';
  const rawFallback = flagValue('--fallback') ?? env.LLM_FALLBACK;

  assertValidProvider(rawPrimary);
  const primary: LlmProviderName = rawPrimary;
  let fallback: LlmProviderName | undefined;
  if (rawFallback) {
    assertValidProvider(rawFallback);
    fallback = rawFallback;
  }

  return fallback ? { provider: primary, fallback } : { provider: primary };
}

/** Build an LlmProvider from a spec + env. */
export function createLlmProvider(
  spec: ProviderSpec,
  env: NodeJS.ProcessEnv = process.env
): LlmProvider {
  const primary = buildProvider(spec.provider, env);
  if (!spec.fallback || spec.fallback === spec.provider) {
    return primary;
  }
  const fallback = buildProvider(spec.fallback, env);
  return new FallbackLlmProvider(primary, fallback);
}

function buildProvider(
  name: LlmProviderName,
  env: NodeJS.ProcessEnv
): LlmProvider {
  switch (name) {
    case 'gemini': {
      const apiKey = env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error(
          'GEMINI_API_KEY environment variable is required for the gemini LLM provider'
        );
      }
      return new GeminiProvider(apiKey);
    }
    case 'claude-cli':
      return new ClaudeCliProvider();
  }
}

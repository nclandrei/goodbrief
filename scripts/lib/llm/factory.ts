import type { LlmProvider, LlmProviderName } from './provider.js';
import { GeminiProvider } from './gemini-provider.js';
import { ClaudeCliProvider } from './claude-cli-provider.js';
import { OpenRouterProvider } from './openrouter-provider.js';
import { FallbackLlmProvider } from './fallback-provider.js';

export interface ProviderSpec {
  provider: LlmProviderName;
  fallback?: LlmProviderName;
}

const VALID_PROVIDERS: readonly LlmProviderName[] = [
  'gemini',
  'claude-cli',
  'openrouter',
];

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
 *   --llm <gemini|claude-cli|openrouter>       primary provider
 *   --fallback <gemini|claude-cli|openrouter>  fallback on quota errors
 *   LLM_PROVIDER=<name>                        same as --llm
 *   LLM_FALLBACK=<name>                        same as --fallback
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

/**
 * Guards against selecting a provider that can't run in the current
 * environment. Today that's claude-cli in CI: the Claude Code headless CLI
 * depends on an interactive subscription session (or `CLAUDE_CODE_OAUTH_TOKEN`
 * that we don't wire up in Actions), so letting a workflow silently try to
 * exec `claude` only to get a confusing "binary not found" mid-pipeline is
 * worse than failing fast with a clear message.
 *
 * GitHub Actions sets `CI=true` for every run; local shells typically do not.
 * Tests drive this deterministically via the `env` argument.
 */
export function assertProviderAllowed(
  name: LlmProviderName,
  env: NodeJS.ProcessEnv = process.env
): void {
  if (name === 'claude-cli' && env.CI === 'true') {
    throw new Error(
      'The "claude-cli" LLM provider is not allowed in CI because it requires ' +
        'an interactive Claude Code session. Use --llm gemini or --llm openrouter ' +
        'in CI workflows; --llm claude-cli is for local recovery only.'
    );
  }
}

function buildProvider(
  name: LlmProviderName,
  env: NodeJS.ProcessEnv
): LlmProvider {
  assertProviderAllowed(name, env);
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
    case 'openrouter': {
      const apiKey = env.OPENROUTER_API_KEY;
      if (!apiKey) {
        throw new Error(
          'OPENROUTER_API_KEY environment variable is required for the openrouter LLM provider'
        );
      }
      return new OpenRouterProvider({
        apiKey,
        model: env.OPENROUTER_MODEL,
        httpReferer: env.OPENROUTER_HTTP_REFERER,
        appTitle: env.OPENROUTER_APP_TITLE,
      });
    }
  }
}

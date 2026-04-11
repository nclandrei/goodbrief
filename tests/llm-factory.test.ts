import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertProviderAllowed,
  createLlmProvider,
  resolveProviderSpecFromArgs,
} from '../scripts/lib/llm/factory.js';
import { GeminiProvider } from '../scripts/lib/llm/gemini-provider.js';
import { ClaudeCliProvider } from '../scripts/lib/llm/claude-cli-provider.js';
import { OpenRouterProvider } from '../scripts/lib/llm/openrouter-provider.js';
import { FallbackLlmProvider } from '../scripts/lib/llm/fallback-provider.js';

test('resolveProviderSpecFromArgs: defaults to gemini', () => {
  const spec = resolveProviderSpecFromArgs([], {});
  assert.equal(spec.provider, 'gemini');
  assert.equal(spec.fallback, undefined);
});

test('resolveProviderSpecFromArgs: --llm claude-cli selects claude', () => {
  const spec = resolveProviderSpecFromArgs(['--llm', 'claude-cli'], {});
  assert.equal(spec.provider, 'claude-cli');
});

test('resolveProviderSpecFromArgs: LLM_PROVIDER env', () => {
  const spec = resolveProviderSpecFromArgs([], { LLM_PROVIDER: 'claude-cli' });
  assert.equal(spec.provider, 'claude-cli');
});

test('resolveProviderSpecFromArgs: --llm overrides env', () => {
  const spec = resolveProviderSpecFromArgs(['--llm', 'gemini'], {
    LLM_PROVIDER: 'claude-cli',
  });
  assert.equal(spec.provider, 'gemini');
});

test('resolveProviderSpecFromArgs: --fallback claude-cli sets fallback', () => {
  const spec = resolveProviderSpecFromArgs(['--fallback', 'claude-cli'], {});
  assert.equal(spec.provider, 'gemini');
  assert.equal(spec.fallback, 'claude-cli');
});

test('resolveProviderSpecFromArgs: LLM_FALLBACK env sets fallback', () => {
  const spec = resolveProviderSpecFromArgs([], { LLM_FALLBACK: 'claude-cli' });
  assert.equal(spec.fallback, 'claude-cli');
});

test('resolveProviderSpecFromArgs: unknown --llm value throws', () => {
  assert.throws(
    () => resolveProviderSpecFromArgs(['--llm', 'gpt-5'], {}),
    /Unknown LLM provider/
  );
});

test('resolveProviderSpecFromArgs: --llm openrouter selects openrouter', () => {
  const spec = resolveProviderSpecFromArgs(['--llm', 'openrouter'], {});
  assert.equal(spec.provider, 'openrouter');
});

test('resolveProviderSpecFromArgs: LLM_PROVIDER=openrouter from env', () => {
  const spec = resolveProviderSpecFromArgs([], { LLM_PROVIDER: 'openrouter' });
  assert.equal(spec.provider, 'openrouter');
});

test('resolveProviderSpecFromArgs: --fallback openrouter sets fallback', () => {
  const spec = resolveProviderSpecFromArgs(['--fallback', 'openrouter'], {});
  assert.equal(spec.provider, 'gemini');
  assert.equal(spec.fallback, 'openrouter');
});

test('createLlmProvider: gemini requires api key', () => {
  assert.throws(
    () => createLlmProvider({ provider: 'gemini' }, {}),
    /GEMINI_API_KEY/
  );
});

test('createLlmProvider: gemini builds GeminiProvider', () => {
  const provider = createLlmProvider(
    { provider: 'gemini' },
    { GEMINI_API_KEY: 'test-key' }
  );
  assert.ok(provider instanceof GeminiProvider);
  assert.equal(provider.name, 'gemini');
});

test('createLlmProvider: claude-cli builds ClaudeCliProvider (no api key required)', () => {
  const provider = createLlmProvider({ provider: 'claude-cli' }, {});
  assert.ok(provider instanceof ClaudeCliProvider);
  assert.equal(provider.name, 'claude-cli');
});

test('createLlmProvider: with fallback wraps in FallbackLlmProvider', () => {
  const provider = createLlmProvider(
    { provider: 'gemini', fallback: 'claude-cli' },
    { GEMINI_API_KEY: 'test-key' }
  );
  assert.ok(provider instanceof FallbackLlmProvider);
});

test('createLlmProvider: fallback=same as primary is a no-op', () => {
  const provider = createLlmProvider(
    { provider: 'claude-cli', fallback: 'claude-cli' },
    {}
  );
  assert.ok(provider instanceof ClaudeCliProvider);
});

test('createLlmProvider: openrouter requires OPENROUTER_API_KEY', () => {
  assert.throws(
    () => createLlmProvider({ provider: 'openrouter' }, {}),
    /OPENROUTER_API_KEY/
  );
});

test('createLlmProvider: openrouter builds OpenRouterProvider with api key', () => {
  const provider = createLlmProvider(
    { provider: 'openrouter' },
    { OPENROUTER_API_KEY: 'sk-or-v1-test' }
  );
  assert.ok(provider instanceof OpenRouterProvider);
  assert.equal(provider.name, 'openrouter');
});

test('createLlmProvider: gemini primary + openrouter fallback wraps in FallbackLlmProvider', () => {
  const provider = createLlmProvider(
    { provider: 'gemini', fallback: 'openrouter' },
    { GEMINI_API_KEY: 'test-key', OPENROUTER_API_KEY: 'sk-or-v1-test' }
  );
  assert.ok(provider instanceof FallbackLlmProvider);
});

// ---------- CI guard: claude-cli must be local-only ----------

test('assertProviderAllowed: blocks claude-cli when CI=true', () => {
  assert.throws(
    () => assertProviderAllowed('claude-cli', { CI: 'true' }),
    /claude-cli.*CI/
  );
});

test('assertProviderAllowed: allows gemini in CI', () => {
  assert.doesNotThrow(() =>
    assertProviderAllowed('gemini', { CI: 'true' })
  );
});

test('assertProviderAllowed: allows openrouter in CI', () => {
  assert.doesNotThrow(() =>
    assertProviderAllowed('openrouter', { CI: 'true' })
  );
});

test('assertProviderAllowed: allows claude-cli locally (no CI env)', () => {
  assert.doesNotThrow(() => assertProviderAllowed('claude-cli', {}));
});

test('assertProviderAllowed: allows claude-cli when CI=false', () => {
  assert.doesNotThrow(() =>
    assertProviderAllowed('claude-cli', { CI: 'false' })
  );
});

test('createLlmProvider: claude-cli in CI throws a clear error', () => {
  assert.throws(
    () => createLlmProvider({ provider: 'claude-cli' }, { CI: 'true' }),
    /claude-cli.*CI/
  );
});

test('createLlmProvider: claude-cli as fallback in CI throws', () => {
  assert.throws(
    () =>
      createLlmProvider(
        { provider: 'gemini', fallback: 'claude-cli' },
        { CI: 'true', GEMINI_API_KEY: 'test-key' }
      ),
    /claude-cli.*CI/
  );
});

test('createLlmProvider: openrouter works in CI when OPENROUTER_API_KEY is set', () => {
  const provider = createLlmProvider(
    { provider: 'openrouter' },
    { CI: 'true', OPENROUTER_API_KEY: 'sk-or-v1-test' }
  );
  assert.ok(provider);
  assert.equal(provider.name, 'openrouter');
});

test('createLlmProvider: gemini works in CI when GEMINI_API_KEY is set', () => {
  const provider = createLlmProvider(
    { provider: 'gemini' },
    { CI: 'true', GEMINI_API_KEY: 'test-key' }
  );
  assert.ok(provider);
  assert.equal(provider.name, 'gemini');
});

test('createLlmProvider: gemini in CI does NOT require OPENROUTER_API_KEY', () => {
  // Confirms the "don't force both keys" contract: missing OPENROUTER_API_KEY
  // must not block a gemini-only CI run.
  assert.doesNotThrow(() =>
    createLlmProvider(
      { provider: 'gemini' },
      { CI: 'true', GEMINI_API_KEY: 'test-key' }
    )
  );
});

test('createLlmProvider: openrouter does NOT require GEMINI_API_KEY', () => {
  assert.doesNotThrow(() =>
    createLlmProvider(
      { provider: 'openrouter' },
      { OPENROUTER_API_KEY: 'sk-or-v1-test' }
    )
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLlmProvider,
  resolveProviderSpecFromArgs,
} from '../scripts/lib/llm/factory.js';
import { GeminiProvider } from '../scripts/lib/llm/gemini-provider.js';
import { ClaudeCliProvider } from '../scripts/lib/llm/claude-cli-provider.js';
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

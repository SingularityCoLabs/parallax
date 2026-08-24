import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  parseCommand,
  parseModelSelector,
  formatProviders,
  formatModels,
  formatHelp,
} from '../src/cli/replCommands.ts';
import { missingKeyMessage, noProviderConfiguredMessage } from '../src/cli/setupGuidance.ts';
import { getProvider } from '../src/config/index.ts';

const ENV_KEYS = ['PARALLAX_API_KEY', 'ANTHROPIC_API_KEY', 'NVIDIA_API_KEY', 'OPENAI_API_KEY'];
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('parseCommand', () => {
  it('treats non-slash lines as ordinary messages', () => {
    expect(parseCommand('hello there')).toEqual({ kind: 'none' });
    expect(parseCommand('  read the file  ')).toEqual({ kind: 'none' });
  });

  it('parses each command with and without an argument', () => {
    expect(parseCommand('/help')).toEqual({ kind: 'help' });
    expect(parseCommand('/?')).toEqual({ kind: 'help' });
    expect(parseCommand('/providers')).toEqual({ kind: 'providers' });
    expect(parseCommand('/models')).toEqual({ kind: 'models' });
    expect(parseCommand('/models anthropic')).toEqual({ kind: 'models', arg: 'anthropic' });
    expect(parseCommand('/provider openai')).toEqual({ kind: 'provider', arg: 'openai' });
    expect(parseCommand('/model claude-opus-4-8')).toEqual({
      kind: 'model',
      arg: 'claude-opus-4-8',
    });
    expect(parseCommand('/m')).toEqual({ kind: 'model' });
    expect(parseCommand('/m openai/gpt-4o')).toEqual({
      kind: 'model',
      arg: 'openai/gpt-4o',
    });
  });

  it('is case-insensitive on the command name and trims the arg', () => {
    expect(parseCommand('/MODEL  gpt-4o ')).toEqual({ kind: 'model', arg: 'gpt-4o' });
  });

  it('flags unknown commands', () => {
    expect(parseCommand('/frobnicate')).toEqual({ kind: 'unknown', name: 'frobnicate' });
  });
});

describe('parseModelSelector', () => {
  it('switches provider when the prefix is a known provider id', () => {
    expect(parseModelSelector('anthropic/claude-sonnet-4-6', 'fake')).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    });
    expect(parseModelSelector('openai/gpt-4o', 'nvidia')).toEqual({
      provider: 'openai',
      model: 'gpt-4o',
    });
  });

  it('keeps the current provider for a slash-containing model id that is not a provider', () => {
    // NVIDIA model ids contain a slash but "meta" is not a provider.
    expect(parseModelSelector('meta/llama-3.3-70b-instruct', 'nvidia')).toEqual({
      provider: 'nvidia',
      model: 'meta/llama-3.3-70b-instruct',
    });
  });

  it('treats a bare model id as the current provider', () => {
    expect(parseModelSelector('claude-opus-4-8', 'anthropic')).toEqual({
      provider: 'anthropic',
      model: 'claude-opus-4-8',
    });
  });
});

describe('formatters', () => {
  it('marks the current provider and shows key status', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-x';
    const out = formatProviders('anthropic');
    expect(out).toContain('* anthropic');
    expect(out).toContain('[key ✓]');
    // A provider without a key is flagged.
    expect(out).toContain('[no key]');
  });

  it('lists curated models and marks the current one', () => {
    const out = formatModels('anthropic', 'claude-sonnet-4-6');
    expect(out).toContain('claude-opus-4-8');
    expect(out).toContain('* claude-sonnet-4-6');
  });

  it('notes when a provider accepts any model id', () => {
    expect(formatModels('custom')).toContain('any model id');
  });

  it('handles an unknown provider gracefully', () => {
    expect(formatModels('nope')).toContain('Unknown provider');
  });

  it('an unknown provider id resolves to undefined (guards the switch handler)', () => {
    // The REPL's switch handler relies on this to reject `/provider bogus`
    // before it reaches config validation.
    expect(getProvider('bogus')).toBeUndefined();
    expect(getProvider('anthropic')).toBeDefined();
  });

  it('help lists the core commands', () => {
    const help = formatHelp();
    for (const cmd of ['/model', '/m', '/provider', '/models', '/providers', '/help']) {
      expect(help).toContain(cmd);
    }
  });
});

describe('setup guidance', () => {
  it('tailors the missing-key message to the selected provider', () => {
    const anthropic = missingKeyMessage('anthropic', 'ANTHROPIC_API_KEY');
    expect(anthropic).toContain('ANTHROPIC_API_KEY');
    expect(anthropic).toContain('PARALLAX_PROVIDER=anthropic');
    expect(anthropic).toContain('console.anthropic.com');
    // Must not leak the NVIDIA onboarding steps into an Anthropic switch.
    expect(anthropic).not.toContain('build.nvidia.com');
    expect(anthropic).not.toContain('NVIDIA_API_KEY');
  });

  it('names the OpenAI key URL and env var for an OpenAI switch', () => {
    const openai = missingKeyMessage('openai', 'OPENAI_API_KEY');
    expect(openai).toContain('OPENAI_API_KEY');
    expect(openai).toContain('platform.openai.com');
  });

  it('keeps NVIDIA as the no-provider onboarding example', () => {
    // The bare-startup path still points newcomers at the free NVIDIA tier.
    const msg = noProviderConfiguredMessage();
    expect(msg).toContain('build.nvidia.com');
    expect(msg).toContain('NVIDIA_API_KEY');
  });
});

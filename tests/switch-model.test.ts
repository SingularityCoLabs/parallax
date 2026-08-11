import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createAgent, applyModelSelection } from '../src/app/index.ts';
import { loadConfig, defaultConfig, type Config } from '../src/config/index.ts';

const ENV_KEYS = ['PARALLAX_PROVIDER', 'PARALLAX_MODEL', 'PARALLAX_API_KEY', 'NVIDIA_API_KEY'];
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

describe('applyModelSelection (history-preserving switch)', () => {
  it('updates the session provider/model in place and keeps prior messages', async () => {
    // Start on the fake provider (no key needed), in-memory store.
    const agent = createAgent({ config: loadConfig() });
    try {
      const session = await agent.facade.createSession({
        cwd: process.cwd(),
        permissionMode: 'read-only',
      });
      // Seed a turn's worth of history.
      await agent.facade.startTurn(session.id, 'first message');
      const before = await agent.store.listMessages(session.id);
      expect(before.length).toBeGreaterThan(0);

      // Switch to NVIDIA (OpenAI-wire) with an injected key via env.
      process.env.NVIDIA_API_KEY = 'nvapi-test';
      const nextConfig: Config = {
        ...defaultConfig(),
        provider: 'nvidia',
        defaultModel: 'meta/llama-3.3-70b-instruct',
      };
      const applied = await applyModelSelection(agent, nextConfig, session.id);
      expect(applied).toEqual({ provider: 'nvidia', model: 'meta/llama-3.3-70b-instruct' });

      // The session now reflects the new provider/model...
      const updated = await agent.store.getSession(session.id);
      expect(updated?.provider).toBe('nvidia');
      expect(updated?.model).toBe('meta/llama-3.3-70b-instruct');

      // ...and the conversation history is untouched (same session, same messages).
      const after = await agent.store.listMessages(session.id);
      expect(after.length).toBe(before.length);
      expect(after[0]?.content).toBe('first message');
    } finally {
      agent.facade.close();
    }
  });

  it('leaves the agent on its current provider when the new key is missing', async () => {
    const agent = createAgent({ config: loadConfig() });
    try {
      const session = await agent.facade.createSession({
        cwd: process.cwd(),
        permissionMode: 'read-only',
      });
      // Switching to a real provider with no key throws — caller keeps working.
      const nextConfig: Config = { ...defaultConfig(), provider: 'anthropic' };
      await expect(applyModelSelection(agent, nextConfig, session.id)).rejects.toThrow();

      // Session provider is unchanged (still fake).
      const stillFake = await agent.store.getSession(session.id);
      expect(stillFake?.provider).toBe('fake');
    } finally {
      agent.facade.close();
    }
  });
});

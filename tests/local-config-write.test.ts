import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveLocalConfig, loadLocalConfig, userConfigPath } from '../src/config/localConfig.ts';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'parallax-home-'));
  process.env.PARALLAX_HOME = home;
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  delete process.env.PARALLAX_HOME;
});

describe('saveLocalConfig', () => {
  it('persists provider/model/theme and reads back via loadLocalConfig', () => {
    saveLocalConfig({ provider: 'nvidia', model: 'meta/llama-3.3-70b-instruct', theme: 'light' });
    const loaded = loadLocalConfig();
    expect(loaded.provider).toBe('nvidia');
    expect(loaded.model).toBe('meta/llama-3.3-70b-instruct');
    expect(loaded.theme).toBe('light');
  });

  it('merges into an existing file, preserving unrelated keys', () => {
    writeFileSync(
      userConfigPath(),
      JSON.stringify({ theme: 'dark', providers: { custom: { baseURL: 'http://x' } } }, null, 2),
    );
    saveLocalConfig({ provider: 'openai', model: 'gpt-4o' });
    const raw = JSON.parse(readFileSync(userConfigPath(), 'utf8'));
    expect(raw.provider).toBe('openai');
    expect(raw.model).toBe('gpt-4o');
    expect(raw.theme).toBe('dark'); // untouched
    expect(raw.providers.custom.baseURL).toBe('http://x'); // untouched
  });

  it('applies only the keys present in the patch', () => {
    saveLocalConfig({ provider: 'openai', model: 'gpt-4o' });
    saveLocalConfig({ theme: 'light' }); // must not wipe provider/model
    const loaded = loadLocalConfig();
    expect(loaded.provider).toBe('openai');
    expect(loaded.model).toBe('gpt-4o');
    expect(loaded.theme).toBe('light');
  });

  it('recovers from a malformed existing file by overwriting cleanly', () => {
    writeFileSync(userConfigPath(), '{ not valid json');
    saveLocalConfig({ provider: 'openai' });
    expect(loadLocalConfig().provider).toBe('openai');
  });
});

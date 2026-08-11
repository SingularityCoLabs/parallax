import { getProvider } from '../config/index.ts';

/**
 * A startup failure the user can fix, carrying the instructions to fix it.
 * The CLI prints `message` verbatim and exits non-zero — no stack trace, because
 * nothing here is a bug in Parallax (blueprint §25: errors are actionable).
 */
export class SetupRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SetupRequiredError';
  }
}

const SETUP_STEPS =
  '  1. Get a free API key at https://build.nvidia.com (it starts with "nvapi-").\n' +
  '  2. Point Parallax at it, either in your shell:\n' +
  '       export PARALLAX_PROVIDER=nvidia\n' +
  '       export NVIDIA_API_KEY=nvapi-...\n' +
  '     ...or in a .env file in this directory (auto-loaded, git-ignored):\n' +
  "       printf 'PARALLAX_PROVIDER=nvidia\\nNVIDIA_API_KEY=nvapi-...\\n' > .env\n" +
  '  3. Run `parallax` again.\n';

/** No provider configured — Parallax is still on the offline fake provider. */
export function noProviderConfiguredMessage(): string {
  return (
    'Parallax has no model configured yet, so there is no agent to talk to.\n\n' +
    'Set one up:\n' +
    SETUP_STEPS +
    '\nNo key handy? Try the offline scripted workflow instead:\n' +
    '  parallax demo edit-fix\n'
  );
}

/** Provider selected but its key is absent. Steps are tailored to the provider. */
export function missingKeyMessage(provider: string, envVar: string): string {
  const info = getProvider(provider);
  const label = info?.label ?? provider;
  const keyUrl = info?.keyUrl;
  const steps = [
    ...(keyUrl ? [`  1. Get an API key at ${keyUrl}.`] : []),
    `  ${keyUrl ? 2 : 1}. Point Parallax at it, either in your shell:`,
    `       export PARALLAX_PROVIDER=${provider}`,
    `       export ${envVar}=...`,
    '     ...or in a .env file in this directory (auto-loaded, git-ignored):',
    `       printf 'PARALLAX_PROVIDER=${provider}\\n${envVar}=...\\n' > .env`,
    `  ${keyUrl ? 3 : 2}. Run \`parallax\` again.`,
  ].join('\n');
  return (
    `Provider "${label}" is selected but ${envVar} is not set, so Parallax cannot ` +
    'reach the model.\n\n' +
    'Set it up:\n' +
    `${steps}\n`
  );
}

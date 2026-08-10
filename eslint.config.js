import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Architectural seams (blueprint §7.1, §53). Each layer lists the *other* layers
 * it must NOT import. Enforced via no-restricted-imports on the import specifier
 * (relative imports contain `/<layer>/`). `app` is the composition root and has
 * no restrictions; `protocol`/`observability` are leaves.
 */
const ALL = [
  'protocol',
  'observability',
  'config',
  'providers',
  'tools',
  'policy',
  'executor',
  'context',
  'sessions',
  'runtime',
  'app',
  'cli',
];

/** layer -> layers it is allowed to import (besides itself) */
const ALLOW = {
  protocol: [],
  observability: ['protocol'],
  config: ['protocol', 'observability'],
  providers: ['protocol', 'observability'],
  tools: ['protocol', 'observability', 'config', 'executor'],
  policy: ['protocol', 'observability', 'config', 'tools'],
  executor: ['protocol', 'observability', 'config'],
  context: ['protocol', 'observability', 'config', 'tools', 'providers'],
  sessions: ['protocol', 'observability', 'config'],
  runtime: [
    'protocol',
    'observability',
    'config',
    'providers',
    'tools',
    'policy',
    'executor',
    'context',
    'sessions',
  ],
  app: ALL,
  cli: ['protocol', 'config', 'app'],
};

const boundaryConfigs = Object.entries(ALLOW).map(([layer, allowed]) => {
  const forbidden = ALL.filter((l) => l !== layer && !allowed.includes(l));
  return {
    files: [`src/${layer}/**/*.ts`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: forbidden.map((f) => ({
            regex: `(^|/)${f}/`,
            message: `Layer "${layer}" must not import from "${f}" (architectural boundary).`,
          })),
        },
      ],
    },
  };
});

export default tseslint.config(
  { ignores: ['node_modules', 'dist', 'coverage', '**/*.d.ts', 'tests/fixtures/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  ...boundaryConfigs,
  {
    files: ['tests/**/*.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
);

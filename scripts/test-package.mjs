import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
const packageName = manifest.name;
const expectedVersion = manifest.version;

assert.equal(typeof packageName, 'string');
assert.equal(typeof expectedVersion, 'string');
assert.notEqual(manifest.private, true, 'published package must not be private');

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npmEnvironment = {
  ...process.env,
  CI: process.env.CI ?? '1',
  NO_COLOR: '1',
  npm_config_audit: 'false',
  npm_config_dry_run: 'false',
  npm_config_fund: 'false',
  npm_config_global: 'false',
  npm_config_ignore_scripts: 'false',
  npm_config_json: 'false',
  npm_config_update_notifier: 'false',
};

function run(command, args, { cwd = projectRoot, capture = false, env = process.env } = {}) {
  process.stdout.write(`> ${command} ${args.join(' ')}\n`);
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (capture) {
      if (result.stdout) process.stderr.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
    }
    throw new Error(`${command} exited with status ${result.status ?? 'unknown'}`);
  }
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function runNpm(args, options = {}) {
  return run(npmCommand, args, { ...options, env: npmEnvironment });
}

const temporaryRoot = mkdtempSync(join(tmpdir(), 'parallax-package-test-'));
const packedDirectory = join(temporaryRoot, 'packed');
const consumerDirectory = join(temporaryRoot, 'consumer');
mkdirSync(packedDirectory);
mkdirSync(consumerDirectory);

try {
  // `--dry-run=false` matters when reached through `npm publish --dry-run`.
  runNpm(['pack', '--dry-run=false', '--pack-destination', packedDirectory]);

  const tarballs = readdirSync(packedDirectory).filter((name) => name.endsWith('.tgz'));
  assert.equal(tarballs.length, 1, `expected one tarball, found ${tarballs.length}`);
  const tarball = join(packedDirectory, tarballs[0]);

  writeFileSync(
    join(consumerDirectory, 'package.json'),
    `${JSON.stringify({ name: 'parallax-package-consumer', private: true, type: 'module' }, null, 2)}\n`,
  );

  runNpm(
    [
      'install',
      '--dry-run=false',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      '--omit=dev',
      relative(consumerDirectory, tarball),
    ],
    { cwd: consumerDirectory },
  );

  const installedRoot = join(consumerDirectory, 'node_modules', ...packageName.split('/'));
  const installedManifest = JSON.parse(readFileSync(join(installedRoot, 'package.json'), 'utf8'));
  assert.equal(installedManifest.name, packageName);
  assert.equal(installedManifest.version, expectedVersion);
  assert.equal(installedManifest.bin.parallax, manifest.bin.parallax);
  assert.ok(existsSync(join(installedRoot, 'dist', 'index.js')));
  assert.ok(existsSync(join(installedRoot, 'dist', 'index.d.ts')));
  assert.ok(existsSync(join(installedRoot, 'dist', 'cli', 'index.js')));
  assert.ok(!existsSync(join(installedRoot, 'src')), 'source tree leaked into package');
  assert.ok(!existsSync(join(installedRoot, 'tests')), 'tests leaked into package');
  assert.ok(!existsSync(join(installedRoot, '.github')), 'GitHub metadata leaked into package');

  const installedCli = readFileSync(join(installedRoot, 'dist', 'cli', 'index.js'), 'utf8');
  assert.ok(installedCli.startsWith('#!/usr/bin/env node\n'));

  const localBin = join(
    consumerDirectory,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'parallax.cmd' : 'parallax',
  );
  assert.ok(existsSync(localBin), 'npm did not create the parallax bin shim');

  const cli = (args) =>
    runNpm(['exec', '--offline', '--', 'parallax', ...args], {
      cwd: consumerDirectory,
      capture: true,
    });

  assert.equal(cli(['--version']).stdout.trim(), expectedVersion);
  assert.match(cli(['--help']).stdout, /Usage:\s+parallax/);
  const scenarios = cli(['demo', '--list']).stdout;
  assert.match(scenarios, /\binspect\b/);
  assert.match(scenarios, /\bedit-fix\b/);

  const demoDirectory = join(consumerDirectory, 'demo-workspace');
  mkdirSync(demoDirectory);
  writeFileSync(join(demoDirectory, 'sum.mjs'), 'export const sum = (a, b) => a - b;\n');
  writeFileSync(
    join(demoDirectory, 'test.mjs'),
    `import assert from 'node:assert/strict';
import { sum } from './sum.mjs';
assert.equal(sum(2, 3), 5);
`,
  );
  const demo = cli(['demo', 'edit-fix', '--cwd', demoDirectory, '--yes', '--no-persist']);
  assert.match(demo.stdout, /tests now pass/i);
  assert.match(readFileSync(join(demoDirectory, 'sum.mjs'), 'utf8'), /=> a \+ b/);

  const packageSpecifier = JSON.stringify(packageName);
  writeFileSync(
    join(consumerDirectory, 'sdk-runtime.mjs'),
    `import assert from 'node:assert/strict';
import { VERSION, createAgent, defaultConfig } from ${packageSpecifier};
assert.equal(VERSION, ${JSON.stringify(expectedVersion)});
const agent = createAgent({ config: defaultConfig() });
try {
  const session = await agent.facade.createSession({
    cwd: process.cwd(),
    permissionMode: 'read-only',
  });
  assert.equal(session.provider, 'fake');
  assert.equal(session.permissionMode, 'read-only');
} finally {
  agent.facade.close();
}
process.stdout.write('sdk-runtime-ok\\n');
`,
  );
  assert.match(
    run(process.execPath, ['sdk-runtime.mjs'], {
      cwd: consumerDirectory,
      capture: true,
    }).stdout,
    /sdk-runtime-ok/,
  );

  writeFileSync(
    join(consumerDirectory, 'sdk-consumer.ts'),
    `import {
  VERSION,
  createAgent,
  defaultConfig,
  type Agent,
  type Config,
  type PermissionMode,
  type SessionRecord,
} from ${packageSpecifier};
const config: Config = defaultConfig();
const mode: PermissionMode = 'read-only';
const agent: Agent = createAgent({ config });
const session: Promise<SessionRecord> = agent.facade.createSession({ cwd: '.', permissionMode: mode });
void VERSION;
void session;
agent.facade.close();
`,
  );

  writeFileSync(
    join(consumerDirectory, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2023',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          types: ['node'],
          typeRoots: [join(projectRoot, 'node_modules', '@types')],
        },
        include: ['sdk-consumer.ts'],
      },
      null,
      2,
    )}\n`,
  );

  const typescriptCli = join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc');
  assert.ok(existsSync(typescriptCli), 'run pnpm install before the package test');
  run(process.execPath, [typescriptCli, '--project', 'tsconfig.json', '--pretty', 'false'], {
    cwd: consumerDirectory,
  });

  process.stdout.write(`Package artifact verified: ${packageName}@${expectedVersion}\n`);
} finally {
  if (process.env.KEEP_PACKAGE_TEST_TMP === '1') {
    process.stdout.write(`Kept package-test directory: ${temporaryRoot}\n`);
  } else {
    rmSync(temporaryRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

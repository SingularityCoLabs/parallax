import { modelText, modelToolCall, modelFinal, type FakeStep } from '../providers/index.ts';

/**
 * Scripted demo workflows for the fake provider (blueprint §11.5, §33–§36).
 * Because the fake model cannot interpret a free-form goal, these canned scripts
 * drive the runtime through the milestone scenarios end-to-end. Each returns the
 * FakeStep[] to construct a FakeModelProvider with. Tool-call ids are stable so
 * transcripts are deterministic.
 */
export interface DemoScenario {
  name: string;
  goal: string;
  description: string;
  steps: FakeStep[];
}

/** §33 — inspect a repository (read-only). */
const inspect: DemoScenario = {
  name: 'inspect',
  goal: 'Inspect this project and tell me what it contains.',
  description: 'Read-only: list the directory, read a file, summarize.',
  steps: [
    [
      modelText("I'll inspect the project structure first.\n"),
      modelToolCall('list_directory', { path: '.' }, 'd1'),
    ],
    [modelToolCall('read_file', { path: 'sum.mjs' }, 'r1')],
    [
      modelText(
        'This is a tiny Node project: `sum.mjs` exports a `sum` function and `test.mjs` asserts it.',
      ),
      modelFinal(),
    ],
  ],
};

/** §35 — run tests, find the failure, fix it, re-run (the flagship scenario). */
const editFix: DemoScenario = {
  name: 'edit-fix',
  goal: 'Run the tests, find the failing test, fix it, and verify the fix.',
  description: 'Full workflow: shell(test) → read → edit → shell(test) → summarize.',
  steps: [
    [
      modelText("I'll run the tests first to see the failure.\n"),
      modelToolCall('shell', { command: 'node test.mjs' }, 's1'),
    ],
    [
      modelText('The test failed. Let me read the implementation.\n'),
      modelToolCall('read_file', { path: 'sum.mjs' }, 'r1'),
    ],
    [
      modelText('The `sum` function subtracts instead of adds. Fixing it.\n'),
      modelToolCall(
        'edit_file',
        { path: 'sum.mjs', oldText: '(a, b) => a - b', newText: '(a, b) => a + b' },
        'e1',
      ),
    ],
    [
      modelText('Now re-running the tests to verify.\n'),
      modelToolCall('shell', { command: 'node test.mjs' }, 's2'),
    ],
    [
      modelText('Fixed the bug in sum.mjs (it used `-` instead of `+`) and the tests now pass.'),
      modelFinal(),
    ],
  ],
};

const SCENARIOS: Record<string, DemoScenario> = {
  [inspect.name]: inspect,
  [editFix.name]: editFix,
};

export function getScenario(name: string): DemoScenario | undefined {
  return SCENARIOS[name];
}

export function listScenarios(): DemoScenario[] {
  return Object.values(SCENARIOS);
}

import type { Config } from '../config/index.ts';
import { FakeModelProvider } from '../providers/index.ts';
import { SqliteSessionStore, InMemorySessionStore, type SessionStore } from '../sessions/index.ts';
import type { RuntimeEvent, ApprovalDecision } from '../protocol/index.ts';
import { createRuntime } from './createRuntime.ts';
import { defaultToolset } from './toolset.ts';
import { getScenario } from './demoScenarios.ts';

export interface RunDemoOptions {
  scenario: string;
  cwd: string;
  config: Config;
  dbPath?: string;
  permissionMode?: 'read-only' | 'workspace';
  onEvent: (event: RuntimeEvent) => void;
  /** Resolve an approval request; returns the decision. */
  onApproval: (request: { id: string; title: string }) => Promise<ApprovalDecision>;
}

export interface RunDemoResult {
  sessionId: string;
}

/**
 * Runs a scripted demo scenario end-to-end (blueprint §33–§36). This lives in
 * `app` because it wires provider + store + tools together; the CLI stays a thin
 * client that only supplies rendering and approval callbacks. Returns the
 * session id so the CLI can print resume instructions.
 */
export async function runDemo(options: RunDemoOptions): Promise<RunDemoResult> {
  const scenario = getScenario(options.scenario);
  if (!scenario) {
    throw new Error(`Unknown demo scenario: ${options.scenario}`);
  }

  const store: SessionStore = options.dbPath
    ? new SqliteSessionStore(options.dbPath)
    : new InMemorySessionStore();
  const provider = new FakeModelProvider(scenario.steps);
  const { registerTools } = defaultToolset(options.config);

  const facade = createRuntime({ config: options.config, provider, store, registerTools });

  const unsubscribe = facade.subscribe((event) => {
    options.onEvent(event);
    if (event.type === 'approval.requested') {
      void options
        .onApproval({ id: event.request.id, title: event.request.title })
        .then((decision) => facade.resolveApproval(event.request.id, decision));
    }
  });

  try {
    const session = await facade.createSession({
      cwd: options.cwd,
      permissionMode: options.permissionMode ?? 'workspace',
    });
    await facade.startTurn(session.id, scenario.goal);
    return { sessionId: session.id };
  } finally {
    unsubscribe();
    facade.close();
  }
}

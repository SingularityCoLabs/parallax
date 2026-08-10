import { effectiveModel, type Config } from '../config/index.ts';
import { ContextBuilder } from '../context/index.ts';
import { getLogger } from '../observability/index.ts';
import { PolicyEngine } from '../policy/index.ts';
import type { ModelProvider } from '../providers/index.ts';
import { RuntimeFacade } from '../runtime/index.ts';
import type { SessionStore } from '../sessions/index.ts';
import { ToolRegistry } from '../tools/core/index.ts';

export interface CreateRuntimeOptions {
  config: Config;
  provider: ModelProvider;
  store: SessionStore;
  /**
   * Registers the tool set onto the registry. A callback (rather than an array)
   * so concretely-typed tools register via the generic `register<I,O>` without
   * casts (Zod's covariant output type blocks a heterogeneous array param).
   */
  registerTools: (registry: ToolRegistry) => void;
  /** Headless: auto-deny unanswered approvals after N ms (blueprint §24). */
  approvalAutoDenyMs?: number;
}

/**
 * Composition root (blueprint §7.1 `app`, Principle 2). This is the ONLY place
 * that knows about all layers at once and assembles them. Every other layer
 * depends on interfaces, so provider/store/tools are all swappable here without
 * touching the runtime.
 */
export function createRuntime(options: CreateRuntimeOptions): RuntimeFacade {
  const { config } = options;

  const registry = new ToolRegistry();
  options.registerTools(registry);

  const policy = new PolicyEngine();

  const contextBuilder = new ContextBuilder({
    systemPrompt: config.systemPrompt,
    maxToolResultChars: config.maxToolResultChars,
    maxMessages: config.maxMessages,
  });

  return new RuntimeFacade({
    provider: options.provider,
    registry,
    policy,
    contextBuilder,
    store: options.store,
    defaultModel: effectiveModel(config),
    maxSteps: config.maxSteps,
    logger: getLogger(),
    ...(options.approvalAutoDenyMs !== undefined
      ? { approvalAutoDenyMs: options.approvalAutoDenyMs }
      : {}),
  });
}

import { effectiveModel, type Config } from '../config/index.ts';
import { buildProvider } from './buildProvider.ts';
import type { Agent } from './createAgent.ts';

export interface AppliedModel {
  provider: string;
  model: string;
}

/**
 * Switch the live agent to a new provider/model without ending the session
 * (blueprint §11.4). Builds the provider from `config` (which resolves the API
 * key from the environment and throws `MissingApiKeyError` if absent), swaps it
 * onto the running facade, and updates the session's persisted provider/model so
 * the next turn — on the *same* conversation history — uses the new model.
 *
 * The build happens *before* any mutation, so a missing key leaves the agent on
 * its current, working provider (the caller reports the error; the REPL keeps
 * going).
 */
export async function applyModelSelection(
  agent: Agent,
  config: Config,
  sessionId: string,
): Promise<AppliedModel> {
  const provider = buildProvider(config);
  const model = effectiveModel(config);
  agent.facade.setModelProvider(provider);
  await agent.store.updateSession(sessionId, { provider: config.provider, model });
  return { provider: config.provider, model };
}

/**
 * Well-known tool names that the runtime/policy/UI treat specially, kept in
 * `protocol` (a leaf layer) so `policy`, `runtime`, and `cli` can reference them
 * without importing the `tools` layer (which would cross an architectural
 * boundary; see eslint.config.js). The tool implementations import the same
 * constants, so the string is defined exactly once.
 *
 * - `present_plan` is the plan-mode "exit gate": in `plan` mode it is the one
 *   tool the policy engine turns into an ASK, and approving it flips the session
 *   to `workspace` mode (see PolicyEngine + TurnController).
 * - `update_todos` is the model's task-list tool; the TUI renders its arguments
 *   as a live checklist rather than a generic tool block.
 */
export const PLAN_TOOL_NAME = 'present_plan';
export const TODO_TOOL_NAME = 'update_todos';

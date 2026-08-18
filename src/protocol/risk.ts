import { z } from 'zod';

/**
 * Risk classification a tool declares about itself, and the resource class it
 * touches. These are pure wire/vocabulary types (blueprint §8.4) so they live in
 * `protocol` and can be referenced by tools, policy, and events without creating
 * a dependency cycle.
 */
export type ToolRisk = 'read' | 'write' | 'destructive' | 'network' | 'external_write';

export type ResourceClass = 'pure_read' | 'filesystem_write' | 'shell' | 'network' | 'external';

export const toolRiskSchema: z.ZodType<ToolRisk> = z.enum([
  'read',
  'write',
  'destructive',
  'network',
  'external_write',
]);

export const resourceClassSchema: z.ZodType<ResourceClass> = z.enum([
  'pure_read',
  'filesystem_write',
  'shell',
  'network',
  'external',
]);

/**
 * Deterministic permission modes (blueprint §16.3).
 * - `read-only`: allow reads, block every side effect.
 * - `workspace`: allow reads, ASK for writes/shell/destructive/network.
 * - `plan`: like `read-only` for *gating* (no side effects), but semantically a
 *   "research & propose" mode — the agent inspects and drafts a plan without
 *   touching anything. Toggled with Shift+Tab in the TUI.
 */
export type PermissionMode = 'read-only' | 'workspace' | 'plan';

export const permissionModeSchema: z.ZodType<PermissionMode> = z.enum([
  'read-only',
  'workspace',
  'plan',
]);

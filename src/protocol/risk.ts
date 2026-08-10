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

/** Deterministic permission modes for v0.1 (blueprint §16.3). */
export type PermissionMode = 'read-only' | 'workspace';

export const permissionModeSchema: z.ZodType<PermissionMode> = z.enum(['read-only', 'workspace']);

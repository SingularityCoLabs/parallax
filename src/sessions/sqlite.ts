import type * as NodeSqlite from 'node:sqlite';

/**
 * Access the built-in `node:sqlite` module. It is newer than some bundlers'
 * builtin lists (Vite/Vitest), which would try to resolve `node:sqlite` as a
 * file. `process.getBuiltinModule` returns the real builtin regardless, and the
 * type-only namespace import is erased so it never reaches the bundler.
 */
const sqlite = process.getBuiltinModule('node:sqlite') as unknown as typeof NodeSqlite;

export const DatabaseSyncCtor = sqlite.DatabaseSync;

/** Instance type of a DatabaseSync connection. */
export type DatabaseSyncInstance = InstanceType<typeof NodeSqlite.DatabaseSync>;
export type DatabaseSync = NodeSqlite.DatabaseSync;

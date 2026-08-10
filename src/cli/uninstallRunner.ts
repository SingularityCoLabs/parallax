import { createInterface } from 'node:readline/promises';
import {
  planUninstallWithSessions,
  executeUninstall,
  formatBytes,
  type UninstallPlan,
} from '../app/index.ts';

export interface UninstallCliOptions {
  /** Skip the confirmation prompt (non-interactive). */
  yes: boolean;
  /** Show what would be removed and exit without deleting anything. */
  dryRun: boolean;
  /** Print the package-removal command but keep sessions/state on disk. */
  keepData: boolean;
}

function renderPlan(plan: UninstallPlan): string {
  const lines: string[] = ['Parallax data to remove:'];
  const present = plan.targets.filter((t) => t.exists);
  if (present.length === 0) {
    lines.push(`  (nothing — no Parallax data found at ${plan.home})`);
  } else {
    for (const t of present) {
      lines.push(`  ${t.path}  (${t.label}, ${formatBytes(t.bytes)})`);
    }
    lines.push(`  total: ${formatBytes(plan.totalBytes)}`);
  }
  if (plan.sessionCount !== undefined) {
    lines.push(
      `\n${plan.sessionCount} persisted session${plan.sessionCount === 1 ? '' : 's'} will be deleted permanently.`,
    );
  }
  return `${lines.join('\n')}\n`;
}

function renderPackageStep(plan: UninstallPlan): string {
  if (plan.removeCommand === null) {
    return (
      `\nThis is a source checkout, so there is no installed package to remove.\n` +
      `Delete the repository directory to finish removing Parallax.\n`
    );
  }
  return (
    `\nTo remove the CLI itself, run:\n` +
    `  ${plan.removeCommand}\n` +
    `(or the equivalent for the package manager you installed it with:\n` +
    `  pnpm remove --global ${plan.packageName} · yarn global remove ${plan.packageName})\n`
  );
}

/**
 * `parallax uninstall` — remove Parallax's own on-disk state and print how to
 * remove the binary. Deleting the installed package is intentionally left to the
 * user's package manager: the CLI cannot know how it was installed, and a process
 * deleting its own executable mid-run is not something to guess at.
 *
 * Destructive, so it defaults to asking. `--dry-run` never deletes.
 */
export async function runUninstall(options: UninstallCliOptions): Promise<void> {
  const plan = await planUninstallWithSessions();
  process.stdout.write(renderPlan(plan));

  if (options.keepData) {
    process.stdout.write('\nKeeping data (--keep-data).');
    process.stdout.write(renderPackageStep(plan));
    return;
  }

  if (options.dryRun) {
    process.stdout.write('\nDry run — nothing was deleted.');
    process.stdout.write(renderPackageStep(plan));
    return;
  }

  const hasData = plan.targets.some((t) => t.exists);
  if (hasData && !options.yes) {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    try {
      const answer = (await rl.question('\nDelete this data? [y/N] ')).trim().toLowerCase();
      if (answer !== 'y' && answer !== 'yes') {
        process.stdout.write('Aborted — nothing was deleted.\n');
        return;
      }
    } finally {
      rl.close();
    }
  }

  if (hasData) {
    const result = executeUninstall(plan);
    for (const path of result.removed) process.stdout.write(`Removed ${path}\n`);
    for (const failure of result.failed) {
      process.stderr.write(`Failed to remove ${failure.path}: ${failure.message}\n`);
    }
    if (result.failed.length > 0) process.exitCode = 1;
  }

  process.stdout.write(renderPackageStep(plan));
}

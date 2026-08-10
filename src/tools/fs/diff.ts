/**
 * Minimal LCS-based line diff for edit/write previews (blueprint §13.5). Not a
 * full patch engine — just enough to show the user what will change and to count
 * added/removed lines. O(m·n); inputs are bounded before display.
 */
export interface LineDiff {
  preview: string;
  added: number;
  removed: number;
}

export function lineDiff(before: string, after: string): LineDiff {
  const a = before.split('\n');
  const b = after.split('\n');
  const m = a.length;
  const n = b.length;

  // LCS length table.
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  const lines: string[] = [];
  let added = 0;
  let removed = 0;
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      lines.push(`  ${a[i]}`);
      i += 1;
      j += 1;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      lines.push(`- ${a[i]}`);
      removed += 1;
      i += 1;
    } else {
      lines.push(`+ ${b[j]}`);
      added += 1;
      j += 1;
    }
  }
  while (i < m) {
    lines.push(`- ${a[i]}`);
    removed += 1;
    i += 1;
  }
  while (j < n) {
    lines.push(`+ ${b[j]}`);
    added += 1;
    j += 1;
  }

  return { preview: lines.join('\n'), added, removed };
}

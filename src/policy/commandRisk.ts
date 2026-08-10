/**
 * Very small command risk classifier (blueprint §14, §16.2, §31). v0.1 does not
 * try to parse shell grammar; it flags obviously destructive patterns so the UI
 * can warn. Everything still defaults to ASK regardless — this only escalates
 * the human-facing description, it is not an allow-list.
 */
const DESTRUCTIVE_PATTERNS: Array<{ re: RegExp; why: string }> = [
  { re: /\brm\s+-\w*r\w*f|\brm\s+-\w*f\w*r/i, why: 'recursive force remove' },
  { re: /\brm\s+-[rf]/i, why: 'remove with -r/-f' },
  { re: /\bmkfs\b/i, why: 'filesystem format' },
  { re: /\bdd\b.*\bof=/i, why: 'raw disk write' },
  { re: />\s*\/dev\/(sd|nvme|disk)/i, why: 'write to block device' },
  { re: /\b(shutdown|reboot|halt)\b/i, why: 'system power control' },
  { re: /:\(\)\s*\{.*\}\s*;?\s*:/, why: 'fork bomb' },
  { re: /\bgit\s+push\b.*--force|\bgit\s+push\b.*\s-f\b/i, why: 'force push' },
  { re: /\bsudo\b/i, why: 'privilege escalation' },
];

export interface CommandRisk {
  destructive: boolean;
  reasons: string[];
}

export function classifyCommand(command: string): CommandRisk {
  const reasons: string[] = [];
  for (const { re, why } of DESTRUCTIVE_PATTERNS) {
    if (re.test(command)) reasons.push(why);
  }
  return { destructive: reasons.length > 0, reasons };
}

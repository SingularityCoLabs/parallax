import { createInterface, type Interface } from 'node:readline/promises';
import type { RuntimeEvent } from '../protocol/index.ts';

export interface ApprovalResponder {
  resolveApproval: (approvalId: string, decision: 'allow_once' | 'deny') => boolean;
}

/**
 * Interactive approval handler for the CLI (blueprint §23.1). It subscribes to
 * runtime events and, on `approval.requested`, prompts the user and calls back
 * into the facade's `resolveApproval`. It performs no tool execution or policy —
 * it is purely UI. Prompts are serialized so overlapping asks queue cleanly.
 */
export class ApprovalPrompt {
  private readonly facade: ApprovalResponder;
  private readonly rl: Interface;
  private readonly out: NodeJS.WriteStream;
  private queue: Promise<void> = Promise.resolve();

  constructor(facade: ApprovalResponder, rl: Interface, out: NodeJS.WriteStream = process.stdout) {
    this.facade = facade;
    this.rl = rl;
    this.out = out;
  }

  /** Attach as an event listener; call the returned function to detach. */
  handle = (event: RuntimeEvent): void => {
    if (event.type !== 'approval.requested') return;
    const approvalId = event.request.id;
    // Serialize prompts so two concurrent asks don't fight over stdin.
    this.queue = this.queue.then(async () => {
      const answer = (await this.rl.question('    Allow? [y/N] ')).trim().toLowerCase();
      const decision = answer === 'y' || answer === 'yes' ? 'allow_once' : 'deny';
      this.facade.resolveApproval(approvalId, decision);
    });
  };

  static create(facade: ApprovalResponder, out?: NodeJS.WriteStream): ApprovalPrompt {
    const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: false });
    return new ApprovalPrompt(facade, rl, out);
  }

  close(): void {
    this.rl.close();
  }
}

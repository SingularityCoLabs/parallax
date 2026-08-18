import type { RuntimeEvent } from '../protocol/index.ts';

const dim = (s: string): string => `\x1b[2m${s}\x1b[0m`;
const green = (s: string): string => `\x1b[32m${s}\x1b[0m`;
const red = (s: string): string => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string): string => `\x1b[33m${s}\x1b[0m`;
const bold = (s: string): string => `\x1b[1m${s}\x1b[0m`;

/**
 * Renders runtime events to a terminal (blueprint §23.1, Principle 2). It is a
 * pure consumer of the event stream: it performs NO tool execution, NO provider
 * calls, NO persistence. Swapping this for a TUI (§23.2) changes nothing below
 * the facade.
 */
export class CliRenderer {
  private streaming = false;
  private readonly out: NodeJS.WriteStream;

  constructor(out: NodeJS.WriteStream = process.stdout) {
    this.out = out;
  }

  handle(event: RuntimeEvent): void {
    switch (event.type) {
      case 'session.started':
        this.write(
          dim(
            `session ${event.sessionId.slice(0, 8)} · ${event.provider}:${event.model} · ${event.permissionMode} · ${event.cwd}\n`,
          ),
        );
        break;
      case 'turn.started':
        this.write(`\n${bold('you')} ${event.userText}\n`);
        break;
      case 'model.started':
        this.write(`\n${bold('agent')} `);
        this.streaming = true;
        break;
      case 'assistant.delta':
        this.write(event.text);
        break;
      case 'model.completed':
        if (this.streaming) this.write('\n');
        this.streaming = false;
        break;
      case 'tool.proposed':
        this.write(dim(`  → ${event.call.name}\n`));
        break;
      case 'approval.requested': {
        const r = event.request;
        this.write(`\n${yellow('?')} ${bold(r.title)}`);
        if (r.detail) this.write(dim(`  (${r.detail})`));
        this.write('\n');
        if (r.diffPreview) this.write(this.indent(r.diffPreview));
        break;
      }
      case 'approval.resolved':
        this.write(event.decision === 'deny' ? red('  ✗ denied\n') : green('  ✓ approved\n'));
        break;
      case 'tool.started':
        this.write(dim(`  ${event.toolName} …\n`));
        break;
      case 'tool.stdout':
        this.write(this.indent(event.text));
        break;
      case 'tool.stderr':
        this.write(this.indent(event.text));
        break;
      case 'tool.completed':
        this.write(green(`  ✓ ${event.result.summary}`) + dim(` (${event.result.durationMs}ms)\n`));
        break;
      case 'tool.failed':
        this.write(red(`  ✗ ${event.result.summary}\n`));
        break;
      case 'turn.completed':
        break;
      case 'turn.cancelled':
        this.write(yellow('\n[cancelled]\n'));
        break;
      case 'turn.failed':
        this.write(red(`\n[error: ${event.errorCode}] ${event.message}\n`));
        break;
    }
  }

  private indent(text: string): string {
    return text
      .split('\n')
      .map((line) => (line ? `    ${line}` : line))
      .join('\n');
  }

  private write(text: string): void {
    this.out.write(text);
  }
}

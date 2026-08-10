import type { ToolSchema } from '../protocol/index.ts';
import type { ModelMessage, ModelRequest } from '../providers/index.ts';
import { truncateMiddle } from '../tools/core/index.ts';

export interface ContextBuilderOptions {
  systemPrompt: string;
  /** Per tool-result message cap before it enters the model context. */
  maxToolResultChars: number;
  /** Keep only the most recent N messages (0 = keep all). Blueprint §20.1. */
  maxMessages?: number;
}

export interface BuildInput {
  model: string;
  /** Full conversation projected to model messages (system excluded). */
  messages: ModelMessage[];
  tools: ToolSchema[];
}

/**
 * Converts durable conversation into a *bounded* model-visible request
 * (blueprint §19, §20). v0.1 keeps it deliberately simple: fixed system prompt,
 * per-tool-result truncation, and a recent-message window. Compaction/summaries
 * (§20.2) are an explicit out-of-scope extension.
 */
export class ContextBuilder {
  private readonly options: ContextBuilderOptions;

  constructor(options: ContextBuilderOptions) {
    this.options = options;
  }

  build(input: BuildInput): ModelRequest {
    let messages = input.messages.map((m) => this.boundMessage(m));
    const max = this.options.maxMessages ?? 0;
    if (max > 0 && messages.length > max) {
      messages = messages.slice(messages.length - max);
    }
    return {
      model: input.model,
      system: this.options.systemPrompt,
      messages,
      tools: input.tools,
    };
  }

  private boundMessage(message: ModelMessage): ModelMessage {
    if (message.role !== 'tool') return message;
    const { text } = truncateMiddle(message.content, {
      maxChars: this.options.maxToolResultChars,
    });
    return { ...message, content: text };
  }
}

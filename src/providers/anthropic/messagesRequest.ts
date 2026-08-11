import type { ModelMessage, ModelRequest } from '../ModelRequest.ts';

/** Anthropic content blocks we emit (the subset we use). */
interface AnthropicTextBlock {
  type: 'text';
  text: string;
}
interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}
interface AnthropicToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
}
type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock | AnthropicToolResultBlock;

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: AnthropicContentBlock[];
}

export interface AnthropicMessagesRequest {
  model: string;
  messages: AnthropicMessage[];
  max_tokens: number;
  stream: true;
  system?: string;
  tools?: Array<{ name: string; description: string; input_schema: unknown }>;
}

/** Project a runtime message to an Anthropic (role, blocks) pair, or null. */
function toEntry(m: ModelMessage): AnthropicMessage | null {
  switch (m.role) {
    case 'system':
      // System is carried at the top level; a stray system-role message in the
      // history (not normally produced) has nowhere to go here — drop it.
      return null;
    case 'user':
      return m.content === ''
        ? null
        : { role: 'user', content: [{ type: 'text', text: m.content }] };
    case 'assistant': {
      const blocks: AnthropicContentBlock[] = [];
      // Anthropic rejects empty text blocks; an assistant turn that only made
      // tool calls has empty content, which is fine — just emit the tool_use.
      if (m.content !== '') blocks.push({ type: 'text', text: m.content });
      for (const c of m.toolCalls ?? []) {
        blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.arguments ?? {} });
      }
      return blocks.length > 0 ? { role: 'assistant', content: blocks } : null;
    }
    case 'tool':
      return {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }],
      };
  }
}

/**
 * Convert a runtime `ModelRequest` into an Anthropic `/v1/messages` body
 * (blueprint §11 — vendor mapping stays inside the provider). Anthropic requires
 * roles to alternate and consecutive tool results to live in a single `user`
 * turn, so entries with the same role are merged (this also folds a parallel
 * tool-call batch's results into one message). The system prompt and tools move
 * to their top-level fields.
 */
export function toMessagesRequest(
  request: ModelRequest,
  options: { maxTokens: number },
): AnthropicMessagesRequest {
  const messages: AnthropicMessage[] = [];
  for (const m of request.messages) {
    const entry = toEntry(m);
    if (!entry) continue;
    const last = messages[messages.length - 1];
    if (last && last.role === entry.role) {
      last.content.push(...entry.content);
    } else {
      messages.push(entry);
    }
  }

  const body: AnthropicMessagesRequest = {
    model: request.model,
    messages,
    max_tokens: options.maxTokens,
    stream: true,
  };
  if (request.system !== '') body.system = request.system;
  if (request.tools.length > 0) {
    body.tools = request.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  }
  return body;
}

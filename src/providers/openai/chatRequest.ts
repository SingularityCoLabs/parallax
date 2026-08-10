import type { ModelMessage, ModelRequest } from '../ModelRequest.ts';

/** OpenAI chat message shapes we emit (subset we use). */
interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
}

export interface OpenAiChatRequest {
  model: string;
  messages: OpenAiMessage[];
  tools?: Array<{
    type: 'function';
    function: { name: string; description: string; parameters: unknown };
  }>;
  tool_choice?: 'auto';
  stream: true;
  stream_options?: { include_usage: true };
  temperature?: number;
  max_tokens?: number;
}

function toOpenAiMessage(m: ModelMessage): OpenAiMessage {
  switch (m.role) {
    case 'system':
      return { role: 'system', content: m.content };
    case 'user':
      return { role: 'user', content: m.content };
    case 'assistant': {
      const msg: OpenAiMessage = { role: 'assistant', content: m.content || null };
      if (m.toolCalls && m.toolCalls.length > 0) {
        msg.tool_calls = m.toolCalls.map((c) => ({
          id: c.id,
          type: 'function',
          function: {
            name: c.name,
            // Arguments must be a JSON string on the wire.
            arguments:
              typeof c.arguments === 'string' ? c.arguments : JSON.stringify(c.arguments ?? {}),
          },
        }));
      }
      return msg;
    }
    case 'tool':
      return { role: 'tool', content: m.content, tool_call_id: m.toolCallId };
  }
}

/**
 * Convert a runtime `ModelRequest` into an OpenAI-compatible chat/completions
 * body (blueprint §11 — vendor mapping stays inside the provider). The system
 * prompt becomes the leading system message; tools become function tools.
 */
export function toChatRequest(
  request: ModelRequest,
  options: { temperature?: number; maxTokens?: number },
): OpenAiChatRequest {
  const messages: OpenAiMessage[] = [];
  if (request.system) messages.push({ role: 'system', content: request.system });
  for (const m of request.messages) messages.push(toOpenAiMessage(m));

  const body: OpenAiChatRequest = {
    model: request.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (request.tools.length > 0) {
    body.tools = request.tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
    body.tool_choice = 'auto';
  }
  if (options.temperature !== undefined) body.temperature = options.temperature;
  if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens;
  return body;
}

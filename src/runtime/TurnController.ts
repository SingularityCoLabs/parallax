import type { Logger } from '../observability/index.ts';
import type {
  EmittedEvent,
  EmittedEventBody,
  PermissionMode,
  ToolCall,
  ToolResult,
} from '../protocol/index.ts';
import type { ModelProvider, ModelMessage, ModelRequest } from '../providers/index.ts';
import type { ContextBuilder } from '../context/index.ts';
import type { PolicyEngine } from '../policy/index.ts';
import type { SessionStore, MessageRecord } from '../sessions/index.ts';
import { ErrorCode, fail } from '../tools/core/index.ts';
import type { ToolRegistry, ToolExecutionContext } from '../tools/core/index.ts';
import type { EventBus } from './EventBus.ts';
import type { ApprovalGateway } from './ApprovalGateway.ts';
import type { Scheduler } from './Scheduler.ts';
import { MaxStepsExceededError, TurnCancelledError } from './errors.ts';

export interface TurnDeps {
  store: SessionStore;
  bus: EventBus;
  provider: ModelProvider;
  registry: ToolRegistry;
  policy: PolicyEngine;
  contextBuilder: ContextBuilder;
  scheduler: Scheduler;
  approvals: ApprovalGateway;
  logger: Logger;
  maxSteps: number;
}

export interface TurnContext {
  sessionId: string;
  turnId: string;
  workspaceRoot: string;
  mode: PermissionMode;
  model: string;
  signal: AbortSignal;
}

/** Project durable messages into the model-visible message list. */
function projectMessage(m: MessageRecord): ModelMessage | undefined {
  switch (m.role) {
    case 'system':
      return { role: 'system', content: m.content };
    case 'user':
      return { role: 'user', content: m.content };
    case 'assistant':
      return m.toolCalls
        ? { role: 'assistant', content: m.content, toolCalls: m.toolCalls }
        : { role: 'assistant', content: m.content };
    case 'tool':
      return { role: 'tool', toolCallId: m.toolCallId ?? '', content: m.content };
    default:
      return undefined;
  }
}

/** Compact the tool result into text the model will read. */
function toModelContent(result: ToolResult): string {
  if (result.modelContent !== undefined) return result.modelContent;
  if (!result.ok && result.error) {
    return `ERROR [${result.error.code}]: ${result.error.message}`;
  }
  if (result.data !== undefined) {
    try {
      return `${result.summary}\n${JSON.stringify(result.data)}`;
    } catch {
      return result.summary;
    }
  }
  return result.summary;
}

interface ModelResponse {
  text: string;
  toolCalls: ToolCall[];
  reason: string;
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * Runs a single turn (blueprint §9.2). The ordering is the contract:
 *   model → tool call → lookup → validate input → describe/normalize →
 *   policy → approval (if ask) → execute → persist → back to model.
 * Validation and permission are never skipped because the model "decided"
 * something is safe (Principle 1).
 */
export class TurnController {
  private readonly d: TurnDeps;

  constructor(deps: TurnDeps) {
    this.d = deps;
  }

  async run(ctx: TurnContext): Promise<void> {
    for (let step = 0; step < this.d.maxSteps; step += 1) {
      this.throwIfAborted(ctx);

      const messages = (await this.d.store.listMessages(ctx.sessionId))
        .map(projectMessage)
        .filter((m): m is ModelMessage => m !== undefined);

      const request = this.d.contextBuilder.build({
        model: ctx.model,
        messages,
        tools: this.d.registry.modelSchemas(),
      });

      await this.emit(ctx, { type: 'model.started', turnId: ctx.turnId, step });
      const response = await this.collectModelResponse(ctx, request);

      await this.d.store.appendMessage({
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        role: 'assistant',
        content: response.text,
        ...(response.toolCalls.length > 0 ? { toolCalls: response.toolCalls } : {}),
      });

      await this.emit(ctx, {
        type: 'model.completed',
        turnId: ctx.turnId,
        reason: response.reason,
        ...(response.inputTokens !== undefined ? { inputTokens: response.inputTokens } : {}),
        ...(response.outputTokens !== undefined ? { outputTokens: response.outputTokens } : {}),
      });

      if (response.toolCalls.length === 0) {
        await this.emit(ctx, { type: 'turn.completed', turnId: ctx.turnId });
        await this.d.store.setTurnStatus(ctx.turnId, 'completed', Date.now());
        return;
      }

      for (const call of response.toolCalls) {
        this.throwIfAborted(ctx);
        await this.handleToolCall(ctx, call);
      }
    }

    throw new MaxStepsExceededError(this.d.maxSteps);
  }

  private async collectModelResponse(
    ctx: TurnContext,
    request: ModelRequest,
  ): Promise<ModelResponse> {
    let text = '';
    const toolCalls: ToolCall[] = [];
    let reason = 'stop';
    const response: ModelResponse = { text, toolCalls, reason };

    for await (const event of this.d.provider.stream(request, ctx.signal)) {
      if (ctx.signal.aborted) break;
      switch (event.type) {
        case 'text.delta':
          text += event.text;
          await this.emit(ctx, {
            type: 'assistant.delta',
            turnId: ctx.turnId,
            text: event.text,
          });
          break;
        case 'tool_call.completed':
          toolCalls.push(event.call);
          break;
        case 'usage':
          if (event.inputTokens !== undefined) response.inputTokens = event.inputTokens;
          if (event.outputTokens !== undefined) response.outputTokens = event.outputTokens;
          break;
        case 'completed':
          reason = event.reason;
          break;
      }
    }
    response.text = text;
    response.reason = reason;
    return response;
  }

  private async handleToolCall(ctx: TurnContext, call: ToolCall): Promise<void> {
    await this.emit(ctx, { type: 'tool.proposed', turnId: ctx.turnId, call });
    await this.d.store.recordToolCall({
      id: call.id,
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      toolName: call.name,
      input: call.arguments,
      status: 'proposed',
      createdAt: Date.now(),
    });

    const toolCtx: ToolExecutionContext = {
      callId: call.id,
      workspaceRoot: ctx.workspaceRoot,
      signal: ctx.signal,
      emitStdout: (text) => {
        void this.emit(ctx, { type: 'tool.stdout', turnId: ctx.turnId, callId: call.id, text });
      },
      emitStderr: (text) => {
        void this.emit(ctx, { type: 'tool.stderr', turnId: ctx.turnId, callId: call.id, text });
      },
      logger: this.d.logger,
    };

    // 1. Unknown tool.
    if (!this.d.registry.has(call.name)) {
      await this.finishFailed(
        ctx,
        call,
        fail(call.id, ErrorCode.UnknownTool, `Unknown tool: ${call.name}`),
      );
      return;
    }
    const tool = this.d.registry.get(call.name);

    // 2. Validate input BEFORE anything else (Principle 1).
    const parsed = tool.inputSchema.safeParse(call.arguments);
    if (!parsed.success) {
      const msg = parsed.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
      await this.finishFailed(
        ctx,
        call,
        fail(call.id, ErrorCode.ValidationError, `Invalid arguments: ${msg}`),
      );
      return;
    }
    const input = parsed.data as never;

    // 3. Describe/normalize the action (resolves paths, builds diff preview).
    const descriptor = tool.describe ? await tool.describe(toolCtx, input) : { title: tool.name };

    // 4. Deterministic policy decision.
    const decision = this.d.policy.evaluate({
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      workspaceRoot: ctx.workspaceRoot,
      mode: ctx.mode,
      toolName: tool.name,
      toolCallId: call.id,
      risk: tool.risk,
      outsideWorkspace: descriptor.outsideWorkspace ?? false,
      actionTitle: descriptor.title,
      ...(descriptor.detail !== undefined ? { actionDetail: descriptor.detail } : {}),
      ...(descriptor.diffPreview !== undefined ? { diffPreview: descriptor.diffPreview } : {}),
      ...(descriptor.command !== undefined ? { command: descriptor.command } : {}),
    });

    if (decision.kind === 'deny') {
      const code = descriptor.outsideWorkspace
        ? ErrorCode.PathOutsideWorkspace
        : ErrorCode.PermissionDenied;
      await this.d.store.updateToolCall(call.id, { status: 'denied' });
      await this.finishFailed(ctx, call, fail(call.id, code, decision.reason));
      return;
    }

    // 5. Approval barrier for ASK (blueprint §9.2, §16).
    if (decision.kind === 'ask') {
      const req = decision.approval;
      // Register the waiter BEFORE emitting the request, so a synchronous
      // responder (fast UI / test) that resolves during emit is not lost.
      const wait = this.d.approvals.wait(req.id);
      await this.emit(ctx, { type: 'approval.requested', turnId: ctx.turnId, request: req });
      await this.d.store.recordApproval({
        id: req.id,
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        toolCallId: call.id,
        decision: 'deny',
        createdAt: Date.now(),
      });
      const outcome = await wait;
      await this.emit(ctx, {
        type: 'approval.resolved',
        turnId: ctx.turnId,
        approvalId: req.id,
        decision: outcome,
      });
      await this.d.store.recordApproval({
        id: req.id,
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        toolCallId: call.id,
        decision: outcome,
        createdAt: Date.now(),
        resolvedAt: Date.now(),
      });
      if (outcome === 'deny') {
        await this.d.store.updateToolCall(call.id, { status: 'denied' });
        await this.finishFailed(
          ctx,
          call,
          fail(call.id, ErrorCode.ApprovalDenied, 'User denied the action'),
        );
        return;
      }
    }

    // 6. Execute (approved).
    await this.emit(ctx, {
      type: 'tool.started',
      turnId: ctx.turnId,
      callId: call.id,
      toolName: tool.name,
    });
    await this.d.store.updateToolCall(call.id, { status: 'running' });

    const result = await this.d.scheduler.execute(tool, input, toolCtx);

    // 7. Persist + feed back to the model.
    await this.persistResult(ctx, call, result);
    if (result.ok) {
      await this.emit(ctx, { type: 'tool.completed', turnId: ctx.turnId, result });
    } else {
      await this.emit(ctx, { type: 'tool.failed', turnId: ctx.turnId, result });
    }
  }

  private async finishFailed(ctx: TurnContext, call: ToolCall, result: ToolResult): Promise<void> {
    await this.persistResult(ctx, call, result);
    await this.emit(ctx, { type: 'tool.failed', turnId: ctx.turnId, result });
  }

  private async persistResult(ctx: TurnContext, call: ToolCall, result: ToolResult): Promise<void> {
    await this.d.store.appendMessage({
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      role: 'tool',
      content: toModelContent(result),
      toolCallId: call.id,
    });
    await this.d.store.updateToolCall(call.id, {
      status: result.ok ? 'completed' : 'failed',
      result,
      completedAt: Date.now(),
    });
  }

  private emit(ctx: TurnContext, event: EmittedEventBody): Promise<unknown> {
    return this.d.bus.emit({ ...event, sessionId: ctx.sessionId } as EmittedEvent);
  }

  private throwIfAborted(ctx: TurnContext): void {
    if (ctx.signal.aborted) throw new TurnCancelledError();
  }
}

import type { ApprovalDecision, RuntimeEvent, RuntimeEventOf } from '../../protocol/index.ts';

/**
 * The approval-request shape as it actually arrives on the event stream (the
 * Zod-inferred type, where optional fields are `T | undefined`). Using this
 * instead of the hand-written `ApprovalRequest` interface keeps the reducer and
 * components assignable under `exactOptionalPropertyTypes`.
 */
export type ApprovalReq = RuntimeEventOf<'approval.requested'>['request'];

/**
 * The TUI's render model and the pure reducer that folds the runtime's
 * `RuntimeEvent` stream into it. Kept free of React and Ink so it is trivially
 * unit-testable (see tests/tui-timeline.test.ts) — the hook in
 * `useRuntimeEvents.ts` is a thin wrapper that calls `reduceTimeline` per event.
 *
 * This mirrors what `CliRenderer` does for the plain renderer, but instead of
 * writing bytes it builds a durable, ordered list of items a component tree can
 * render and re-render (streaming assistant text, tool blocks with live output,
 * approval prompts, notices).
 */

export interface SessionInfo {
  sessionId: string;
  provider: string;
  model: string;
  permissionMode: string;
  cwd: string;
}

export interface UserItem {
  kind: 'user';
  id: string;
  text: string;
}

export interface AssistantItem {
  kind: 'assistant';
  id: string;
  /** Correlates with a model step so multi-step turns append to the right block. */
  step: number;
  text: string;
  streaming: boolean;
}

export type ToolStatus = 'proposed' | 'running' | 'completed' | 'failed';

export interface ToolItem {
  kind: 'tool';
  id: string;
  callId: string;
  name: string;
  status: ToolStatus;
  /** Compact human label built from the tool name + a key argument. */
  title: string;
  args: Record<string, unknown>;
  stdout: string;
  stderr: string;
  summary?: string;
  durationMs?: number;
  diffPreview?: string;
}

export interface ApprovalItem {
  kind: 'approval';
  id: string;
  request: ApprovalReq;
  /** `undefined` until the user answers. */
  decision?: ApprovalDecision;
}

export interface NoticeItem {
  kind: 'notice';
  id: string;
  tone: 'error' | 'warn' | 'info';
  text: string;
}

export type TimelineItem = UserItem | AssistantItem | ToolItem | ApprovalItem | NoticeItem;

export interface TimelineState {
  session?: SessionInfo;
  items: TimelineItem[];
  /** True while a turn is in flight (drives the spinner). */
  active: boolean;
  /** The unresolved approval awaiting the user, if any (drives the prompt). */
  pendingApproval?: ApprovalReq;
  /** Cumulative token usage reported by the model, for the footer. */
  usage: { input: number; output: number };
}

export function initialTimeline(): TimelineState {
  return { items: [], active: false, usage: { input: 0, output: 0 } };
}

/** Map an internal tool name to a Claude Code-style label + compact argument. */
export function toolLabel(name: string, args: Record<string, unknown>): string {
  const path = typeof args['path'] === 'string' ? (args['path'] as string) : undefined;
  const command = typeof args['command'] === 'string' ? (args['command'] as string) : undefined;
  const query = typeof args['query'] === 'string' ? (args['query'] as string) : undefined;
  const url = typeof args['url'] === 'string' ? (args['url'] as string) : undefined;
  const todos = Array.isArray(args['todos']) ? (args['todos'] as unknown[]) : undefined;
  switch (name) {
    case 'shell':
      return `Bash(${truncateArg(command ?? '')})`;
    case 'read_file':
      return `Read(${path ?? ''})`;
    case 'write_file':
      return `Write(${path ?? ''})`;
    case 'edit_file':
      return `Update(${path ?? ''})`;
    case 'list_directory':
      return `List(${path ?? '.'})`;
    case 'search_files':
      return `Search(${truncateArg(query ?? '')})`;
    case 'update_todos':
      return `Todo(${todos ? todos.length : 0} item${todos && todos.length === 1 ? '' : 's'})`;
    case 'present_plan':
      return 'Plan';
    case 'web_fetch':
      return `Fetch(${truncateArg(hostOf(url) ?? url ?? '')})`;
    case 'web_search':
      return `WebSearch(${truncateArg(query ?? '')})`;
    default:
      return name;
  }
}

/** Best-effort host extraction for a URL label; falls back to `undefined`. */
function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

function truncateArg(s: string, max = 48): string {
  const oneLine = s.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

/** Find the last item matching a predicate, returning its index or -1. */
function lastIndex(items: TimelineItem[], pred: (i: TimelineItem) => boolean): number {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (item && pred(item)) return i;
  }
  return -1;
}

/** Replace the item at `index` with `next`, returning a new array. */
function replaceAt(items: TimelineItem[], index: number, next: TimelineItem): TimelineItem[] {
  const copy = items.slice();
  copy[index] = next;
  return copy;
}

/**
 * Fold one runtime event into the timeline state (pure). Unknown/irrelevant
 * events return the state unchanged. `seq` is used to mint stable item ids so
 * React keys are stable across re-renders.
 */
export function reduceTimeline(state: TimelineState, event: RuntimeEvent): TimelineState {
  switch (event.type) {
    case 'session.started':
      return {
        ...state,
        session: {
          sessionId: event.sessionId,
          provider: event.provider,
          model: event.model,
          permissionMode: event.permissionMode,
          cwd: event.cwd,
        },
      };

    case 'turn.started':
      return {
        ...state,
        active: true,
        items: [...state.items, { kind: 'user', id: `u-${event.seq}`, text: event.userText }],
      };

    case 'model.started':
      // Open a fresh streaming assistant block for this step; deltas append to it.
      return {
        ...state,
        active: true,
        items: [
          ...state.items,
          { kind: 'assistant', id: `a-${event.seq}`, step: event.step, text: '', streaming: true },
        ],
      };

    case 'assistant.delta': {
      // Append to the open streaming assistant block (opened by model.started).
      const idx = lastIndex(state.items, (i) => i.kind === 'assistant' && i.streaming);
      if (idx === -1) {
        const block: AssistantItem = {
          kind: 'assistant',
          id: `a-${event.seq}`,
          step: 0,
          text: event.text,
          streaming: true,
        };
        return { ...state, items: [...state.items, block] };
      }
      const prev = state.items[idx] as AssistantItem;
      return {
        ...state,
        items: replaceAt(state.items, idx, { ...prev, text: prev.text + event.text }),
      };
    }

    case 'model.completed': {
      const idx = lastIndex(state.items, (i) => i.kind === 'assistant' && i.streaming);
      const usage = {
        input: state.usage.input + (event.inputTokens ?? 0),
        output: state.usage.output + (event.outputTokens ?? 0),
      };
      if (idx === -1) return { ...state, usage };
      const prev = state.items[idx] as AssistantItem;
      // A tool-only step produces no prose — drop the empty block so the
      // transcript isn't littered with bare bullets.
      if (prev.text === '') {
        const items = state.items.slice();
        items.splice(idx, 1);
        return { ...state, usage, items };
      }
      return { ...state, usage, items: replaceAt(state.items, idx, { ...prev, streaming: false }) };
    }

    case 'tool.proposed': {
      const args =
        typeof event.call.arguments === 'object' && event.call.arguments !== null
          ? (event.call.arguments as Record<string, unknown>)
          : {};
      const tool: ToolItem = {
        kind: 'tool',
        id: `t-${event.call.id}`,
        callId: event.call.id,
        name: event.call.name,
        status: 'proposed',
        title: toolLabel(event.call.name, args),
        args,
        stdout: '',
        stderr: '',
      };
      return { ...state, items: [...state.items, tool] };
    }

    case 'approval.requested':
      return {
        ...state,
        pendingApproval: event.request,
        items: [
          ...state.items,
          { kind: 'approval', id: `p-${event.request.id}`, request: event.request },
        ],
      };

    case 'approval.resolved': {
      const clearsPending = state.pendingApproval?.id === event.approvalId;
      const idx = lastIndex(
        state.items,
        (i) => i.kind === 'approval' && i.request.id === event.approvalId,
      );
      const items =
        idx === -1
          ? state.items
          : replaceAt(state.items, idx, {
              ...(state.items[idx] as ApprovalItem),
              decision: event.decision,
            });
      if (clearsPending) {
        const { pendingApproval: _cleared, ...rest } = state;
        return { ...rest, items };
      }
      return { ...state, items };
    }

    case 'tool.started': {
      const idx = lastIndex(state.items, (i) => i.kind === 'tool' && i.callId === event.callId);
      if (idx === -1) return state;
      const prev = state.items[idx] as ToolItem;
      return { ...state, items: replaceAt(state.items, idx, { ...prev, status: 'running' }) };
    }

    case 'tool.stdout':
    case 'tool.stderr': {
      const idx = lastIndex(state.items, (i) => i.kind === 'tool' && i.callId === event.callId);
      if (idx === -1) return state;
      const prev = state.items[idx] as ToolItem;
      const next: ToolItem =
        event.type === 'tool.stdout'
          ? { ...prev, stdout: prev.stdout + event.text }
          : { ...prev, stderr: prev.stderr + event.text };
      return { ...state, items: replaceAt(state.items, idx, next) };
    }

    case 'tool.completed':
    case 'tool.failed': {
      const idx = lastIndex(
        state.items,
        (i) => i.kind === 'tool' && i.callId === event.result.callId,
      );
      if (idx === -1) return state;
      const prev = state.items[idx] as ToolItem;
      const next: ToolItem = {
        ...prev,
        status: event.type === 'tool.completed' ? 'completed' : 'failed',
        summary: event.result.summary,
        ...(event.result.durationMs !== undefined ? { durationMs: event.result.durationMs } : {}),
      };
      return { ...state, items: replaceAt(state.items, idx, next) };
    }

    case 'turn.completed':
      return { ...state, active: false };

    case 'mode.changed':
      // The runtime switched permission mode mid-run (e.g. the plan gate was
      // approved). Reflect it in the session info the footer/header read.
      return state.session
        ? { ...state, session: { ...state.session, permissionMode: event.mode } }
        : state;

    case 'turn.cancelled':
      return {
        ...state,
        active: false,
        items: [
          ...state.items,
          { kind: 'notice', id: `n-${event.seq}`, tone: 'warn', text: 'Cancelled.' },
        ],
      };

    case 'turn.failed':
      return {
        ...state,
        active: false,
        items: [
          ...state.items,
          {
            kind: 'notice',
            id: `n-${event.seq}`,
            tone: 'error',
            text: `[${event.errorCode}] ${event.message}`,
          },
        ],
      };

    default:
      return state;
  }
}

/** Fold a whole event list (used when replaying a resumed session). */
export function reduceAll(events: RuntimeEvent[]): TimelineState {
  return events.reduce(reduceTimeline, initialTimeline());
}

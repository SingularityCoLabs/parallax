import React from 'react';
import { Box, Static } from 'ink';
import type { ApprovalDecision } from '../../../protocol/index.ts';
import { PLAN_TOOL_NAME, TODO_TOOL_NAME } from '../../../protocol/index.ts';
import type { TimelineItem } from '../timeline.ts';
import { type Theme } from '../theme.ts';
import { UserMessage, AssistantMessage, Notice } from './Message.tsx';
import { ToolBlock } from './ToolBlock.tsx';
import { TodoBlock } from './TodoBlock.tsx';
import { PlanBlock } from './PlanBlock.tsx';
import { ApprovalPrompt } from './ApprovalPrompt.tsx';

/**
 * Renders the ordered timeline. Completed items are wrapped in Ink's `<Static>`
 * so they're printed once and never re-rendered (the transcript scrolls up in
 * the terminal's own scrollback, exactly like Claude Code) — only the live tail
 * (streaming assistant text, a running tool, the pending approval) re-renders.
 *
 * The item marked "live" is whichever the runtime is currently updating; we keep
 * the last streaming/running/pending item dynamic and freeze the rest.
 */
function renderItem(
  item: TimelineItem,
  theme: Theme,
  onDecision: (id: string, d: ApprovalDecision) => void,
): React.ReactElement {
  switch (item.kind) {
    case 'user':
      return <UserMessage item={item} theme={theme} />;
    case 'assistant':
      return <AssistantMessage item={item} theme={theme} />;
    case 'tool':
      if (item.name === TODO_TOOL_NAME) return <TodoBlock tool={item} theme={theme} />;
      if (item.name === PLAN_TOOL_NAME) return <PlanBlock tool={item} theme={theme} />;
      return <ToolBlock tool={item} theme={theme} />;
    case 'notice':
      return <Notice item={item} theme={theme} />;
    case 'approval':
      // A resolved approval collapses to nothing (the tool block shows outcome);
      // an unresolved one renders the interactive prompt.
      return item.decision === undefined ? (
        <ApprovalPrompt
          request={item.request}
          theme={theme}
          onDecision={(d) => onDecision(item.request.id, d)}
        />
      ) : (
        <Box />
      );
  }
}

/**
 * Index of the last item that is still "live" (re-rendering). Everything before
 * it is stable and can be made Static.
 */
function firstLiveIndex(items: TimelineItem[]): number {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const it = items[i]!;
    const live =
      (it.kind === 'assistant' && it.streaming) ||
      (it.kind === 'tool' && (it.status === 'running' || it.status === 'proposed')) ||
      (it.kind === 'approval' && it.decision === undefined);
    if (!live) return i + 1;
  }
  return 0;
}

export function Timeline({
  items,
  theme,
  header,
  onDecision,
}: {
  items: TimelineItem[];
  theme: Theme;
  /** Rendered once, above all messages, as the first committed line. */
  header?: React.ReactElement;
  onDecision: (id: string, d: ApprovalDecision) => void;
}): React.ReactElement {
  const liveFrom = firstLiveIndex(items);
  const staticItems = items.slice(0, liveFrom);
  const liveItems = items.slice(liveFrom);

  // Ink commits <Static> output above the live frame, so the header must live
  // inside the Static stream (as a sentinel first entry) to sit above messages.
  type StaticEntry = { id: string; header: true } | TimelineItem;
  const staticEntries: StaticEntry[] = header
    ? [{ id: '__header', header: true }, ...staticItems]
    : staticItems;

  return (
    <Box flexDirection="column">
      <Static items={staticEntries}>
        {(entry) => (
          <Box key={entry.id} flexDirection="column">
            {'header' in entry ? header : renderItem(entry, theme, onDecision)}
          </Box>
        )}
      </Static>
      {liveItems.map((item) => (
        <Box key={item.id} flexDirection="column">
          {renderItem(item, theme, onDecision)}
        </Box>
      ))}
    </Box>
  );
}

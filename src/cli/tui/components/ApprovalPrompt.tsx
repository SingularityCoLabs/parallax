import React from 'react';
import { Box, Text } from 'ink';
import SelectInput, { type IndicatorProps, type ItemProps } from 'ink-select-input';
import type { ApprovalDecision } from '../../../protocol/index.ts';
import { DiffView } from './DiffView.tsx';
import { type Theme } from '../theme.ts';
import type { ApprovalReq } from '../timeline.ts';

/**
 * The interactive approval dialog (Claude Code's Yes / Yes-and-don't-ask-again /
 * No menu). Rendered when a turn is blocked on an `approval.requested`; the
 * selection is routed back through `facade.resolveApproval`. Shows the action
 * title, optional detail, and a colored diff preview for edits.
 */
interface Choice {
  label: string;
  value: ApprovalDecision;
}

const CHOICES: Choice[] = [
  { label: 'Yes', value: 'allow_once' },
  { label: "Yes, and don't ask again this session", value: 'allow_always' },
  { label: 'No, and tell the model what to do differently', value: 'deny' },
];

export function ApprovalPrompt({
  request,
  theme,
  onDecision,
}: {
  request: ApprovalReq;
  theme: Theme;
  onDecision: (decision: ApprovalDecision) => void;
}): React.ReactElement {
  const ThemedIndicator = ({ isSelected = false }: IndicatorProps): React.ReactElement => (
    <Box marginRight={1}>
      <Text color={isSelected ? theme.selection : theme.subtle}>{isSelected ? '❯' : ' '}</Text>
    </Box>
  );
  const ThemedItem = ({ isSelected = false, label }: ItemProps): React.ReactElement => (
    <Text color={isSelected ? theme.selection : theme.text} bold={isSelected}>
      {label}
    </Text>
  );

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.permission}
      paddingX={1}
      marginTop={1}
    >
      <Box>
        <Text color={theme.permission} bold>
          ?{' '}
        </Text>
        <Text color={theme.text} bold>
          {request.title}
        </Text>
        {request.detail !== undefined && <Text color={theme.subtle}> ({request.detail})</Text>}
      </Box>

      {request.diffPreview !== undefined && <DiffView diff={request.diffPreview} theme={theme} />}

      <Box marginTop={1}>
        <SelectInput
          items={CHOICES}
          indicatorComponent={ThemedIndicator}
          itemComponent={ThemedItem}
          onSelect={(item: Choice) => onDecision(item.value)}
        />
      </Box>
    </Box>
  );
}

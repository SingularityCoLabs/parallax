import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ProviderInfo, ModelInfo } from '../../../config/index.ts';
import { glyphs, type Theme } from '../theme.ts';

/**
 * The `/model` configuration overlay (OpenCode-style). A modal, multi-step
 * picker that replaces the timeline while open and owns the keyboard:
 *
 *   1. Provider — every catalog provider, with a key-status glyph.
 *   2. Model    — the provider's models (rich labels), or a free-typed id.
 *   3. API key  — shown only when no key resolves; masked, with a "save to disk"
 *                 toggle.
 *
 * Navigation is hand-rolled on Ink's `useInput` (like `PromptInput`) so the same
 * keys work across every step: type to filter, ↑/↓ to move, Enter to confirm,
 * Backspace to edit, Esc to go back (or cancel on the first step). The provider
 * list is passed in as a snapshot so a background catalog refresh can't reshuffle
 * it mid-interaction.
 */

export interface ModelSelection {
  provider: string;
  model: string;
  /** A key typed here (absent when the provider already has one). */
  apiKey?: string;
  /** Whether to persist `apiKey` to the on-disk credentials store. */
  remember?: boolean;
}

export interface ModelDialogProps {
  theme: Theme;
  /** Snapshot of the catalog, taken when the dialog opened. */
  providers: ProviderInfo[];
  /** Preselect this provider (the desired one when launching unconfigured). */
  initialProviderId?: string;
  /** Whether a key already resolves for a provider (env / creds / session). */
  hasKey: (providerId: string) => boolean;
  onSubmit: (selection: ModelSelection) => void;
  onCancel: () => void;
}

type Step = 'provider' | 'model' | 'key';

/** Most rows shown at once; longer lists scroll around the selection. */
const MAX_VISIBLE = 8;

/**
 * Sentinel row id for the synthetic "use the id I typed" entry on the model
 * step. The angle-bracket form can't be a real model id, so it never collides.
 */
const CUSTOM_ROW = '<custom>';

/** A compact one-line summary of a model's capabilities, when known. */
function formatModelMeta(info: ModelInfo | undefined): string {
  if (!info) return '';
  const parts: string[] = [];
  if (info.limitContext) parts.push(`${Math.round(info.limitContext / 1000)}K ctx`);
  if (info.cost && (info.cost.input || info.cost.output)) {
    parts.push(`$${info.cost.input}/$${info.cost.output}`);
  }
  if (info.reasoning) parts.push('reasoning');
  return parts.join(' · ');
}

/** Case-insensitive substring filter. */
function matches(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/** The slice of `items` to show given the selected index (a scrolling window). */
function windowAround<T>(items: T[], selected: number): { slice: T[]; start: number } {
  if (items.length <= MAX_VISIBLE) return { slice: items, start: 0 };
  const half = Math.floor(MAX_VISIBLE / 2);
  const start = Math.min(Math.max(0, selected - half), items.length - MAX_VISIBLE);
  return { slice: items.slice(start, start + MAX_VISIBLE), start };
}

export function ModelDialog({
  theme,
  providers,
  initialProviderId,
  hasKey,
  onSubmit,
  onCancel,
}: ModelDialogProps): React.ReactElement {
  // Preselecting a provider jumps past the provider list: to the model step if
  // it already has a key, or straight to key entry if it doesn't. Otherwise we
  // start at the provider list.
  const preset = initialProviderId
    ? providers.find((p) => p.id === initialProviderId && p.supported)
    : undefined;
  const presetNeedsKey = preset !== undefined && !hasKey(preset.id);

  const [step, setStep] = useState<Step>(preset ? (presetNeedsKey ? 'key' : 'model') : 'provider');
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState(0);
  const [providerId, setProviderId] = useState(preset?.id ?? '');
  const [keyText, setKeyText] = useState('');
  const [remember, setRemember] = useState(false);
  const [hint, setHint] = useState('');
  // The model chosen while we detour through the key step (its default when we
  // jumped straight to key entry for a preset provider).
  const [pendingModel, setPendingModel] = useState(
    presetNeedsKey ? (preset?.defaultModel ?? '') : '',
  );

  const provider = useMemo(
    () => providers.find((p) => p.id === providerId),
    [providers, providerId],
  );

  // The rows visible on the current list step, after filtering.
  const providerRows = useMemo(
    () => providers.filter((p) => matches(`${p.label} ${p.id}`, filter)),
    [providers, filter],
  );
  const modelRows = useMemo(() => {
    const models = provider?.models ?? [];
    return models.filter((m) => matches(m, filter));
  }, [provider, filter]);
  // On an OpenAI-/Anthropic-wire provider any model id is valid on the wire, so a
  // non-matching filter becomes an explicit "use what I typed" row.
  const allowCustomModel = filter.trim() !== '' && !modelRows.some((m) => m === filter.trim());

  const resetList = (): void => {
    setFilter('');
    setSelected(0);
    setHint('');
  };

  const chooseProvider = (p: ProviderInfo): void => {
    if (!p.supported) {
      setHint(`${p.label} needs a vendor SDK Parallax doesn't ship — pick another.`);
      return;
    }
    setProviderId(p.id);
    setStep('model');
    resetList();
  };

  const chooseModel = (model: string): void => {
    const id = providerId;
    if (hasKey(id)) {
      onSubmit({ provider: id, model });
      return;
    }
    // Needs a key — collect it before applying.
    setPendingModel(model);
    setStep('key');
    setHint('');
  };

  const submitWithKey = (): void => {
    const key = keyText.trim();
    if (key === '') {
      setHint('Enter an API key, or press Esc to go back.');
      return;
    }
    onSubmit({ provider: providerId, model: pendingModel, apiKey: key, remember });
  };

  useInput((input, key) => {
    // Esc: step back, or cancel out of the dialog from the first step.
    if (key.escape) {
      if (step === 'provider') return onCancel();
      if (step === 'model') {
        setStep('provider');
        resetList();
        return;
      }
      setStep('model'); // from key step
      setKeyText('');
      resetList();
      return;
    }

    if (step === 'key') {
      if (key.return) return submitWithKey();
      if (key.tab) {
        setRemember((r) => !r);
        return;
      }
      if (key.backspace || key.delete) {
        setKeyText((v) => v.slice(0, -1));
        return;
      }
      if (key.ctrl || key.meta) return;
      if (input) setKeyText((v) => v + input);
      return;
    }

    // List steps (provider / model) share navigation.
    const rows: unknown[] = step === 'provider' ? providerRows : modelRows;
    const rowCount = rows.length + (step === 'model' && allowCustomModel ? 1 : 0);

    if (key.upArrow) {
      setSelected((i) => (rowCount === 0 ? 0 : (i - 1 + rowCount) % rowCount));
      return;
    }
    if (key.downArrow) {
      setSelected((i) => (rowCount === 0 ? 0 : (i + 1) % rowCount));
      return;
    }
    if (key.return) {
      if (step === 'provider') {
        const p = providerRows[selected];
        if (p) chooseProvider(p);
        return;
      }
      // model step
      if (allowCustomModel && selected >= modelRows.length) {
        chooseModel(filter.trim());
        return;
      }
      const m = modelRows[selected];
      if (m !== undefined) chooseModel(m);
      return;
    }
    if (key.backspace || key.delete) {
      setFilter((v) => v.slice(0, -1));
      setSelected(0);
      return;
    }
    if (key.ctrl || key.meta || key.tab) return;
    if (input) {
      setFilter((v) => v + input);
      setSelected(0);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
      <Box marginBottom={1}>
        <Text color={theme.accent} bold>
          {glyphs.star} Configure model
        </Text>
        <Text color={theme.subtle}>
          {'  '}
          {step === 'provider'
            ? 'select a provider'
            : step === 'model'
              ? `${provider?.label ?? providerId} · select a model`
              : `${provider?.label ?? providerId} · enter API key`}
        </Text>
      </Box>

      {step === 'key' ? (
        <KeyStep theme={theme} value={keyText} remember={remember} provider={provider} />
      ) : (
        <>
          {/* Filter line. */}
          <Box marginBottom={1}>
            <Text color={theme.accent}>{glyphs.caret} </Text>
            {filter === '' ? (
              <Text color={theme.subtle}>type to filter…</Text>
            ) : (
              <Text color={theme.text}>{filter}</Text>
            )}
          </Box>

          {step === 'provider' ? (
            <ProviderList theme={theme} rows={providerRows} selected={selected} hasKey={hasKey} />
          ) : (
            <ModelList
              theme={theme}
              rows={modelRows}
              selected={selected}
              modelInfo={provider?.modelInfo}
              customModel={allowCustomModel ? filter.trim() : undefined}
            />
          )}
        </>
      )}

      {hint !== '' && (
        <Box marginTop={1}>
          <Text color={theme.warning}>{hint}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={theme.subtle}>
          {step === 'key'
            ? '⏎ save · tab toggles remember · esc back'
            : '↑↓ move · ⏎ select · esc ' + (step === 'provider' ? 'cancel' : 'back')}
        </Text>
      </Box>
    </Box>
  );
}

function ProviderList({
  theme,
  rows,
  selected,
  hasKey,
}: {
  theme: Theme;
  rows: ProviderInfo[];
  selected: number;
  hasKey: (id: string) => boolean;
}): React.ReactElement {
  const { slice, start } = windowAround(rows, selected);
  if (rows.length === 0) return <Text color={theme.subtle}>no matching providers</Text>;
  return (
    <Box flexDirection="column">
      {slice.map((p, i) => {
        const idx = start + i;
        const active = idx === selected;
        const keyed = hasKey(p.id);
        const statusGlyph = !p.supported ? '·' : keyed ? glyphs.check : glyphs.cross;
        const statusColor = !p.supported ? theme.subtle : keyed ? theme.success : theme.warning;
        return (
          <Box key={p.id}>
            <Text color={active ? theme.accent : theme.subtle}>{active ? '❯ ' : '  '}</Text>
            <Text color={statusColor}>{statusGlyph} </Text>
            <Text color={theme.text} bold={active}>
              {p.label}
            </Text>
            <Text color={theme.subtle}>
              {' '}
              {p.id}
              {p.supported ? '' : ' · unsupported'}
            </Text>
          </Box>
        );
      })}
      {rows.length > slice.length && (
        <Text color={theme.subtle}>
          {'  '}… {rows.length - slice.length} more
        </Text>
      )}
    </Box>
  );
}

function ModelList({
  theme,
  rows,
  selected,
  modelInfo,
  customModel,
}: {
  theme: Theme;
  rows: string[];
  selected: number;
  modelInfo: Readonly<Record<string, ModelInfo>> | undefined;
  customModel: string | undefined;
}): React.ReactElement {
  // The custom "use what I typed" row sits after the filtered models.
  const augmented = customModel !== undefined ? [...rows, CUSTOM_ROW] : rows;
  const { slice, start } = windowAround(augmented, selected);
  if (augmented.length === 0) return <Text color={theme.subtle}>no models — type an id</Text>;
  return (
    <Box flexDirection="column">
      {slice.map((row, i) => {
        const idx = start + i;
        const active = idx === selected;
        const isCustom = row === CUSTOM_ROW;
        if (isCustom) {
          return (
            <Box key="__custom">
              <Text color={active ? theme.accent : theme.subtle}>{active ? '❯ ' : '  '}</Text>
              <Text color={active ? theme.text : theme.subtle} bold={active}>
                Use “{customModel}”
              </Text>
              <Text color={theme.subtle}> (custom id)</Text>
            </Box>
          );
        }
        const meta = formatModelMeta(modelInfo?.[row]);
        return (
          <Box key={row}>
            <Text color={active ? theme.accent : theme.subtle}>{active ? '❯ ' : '  '}</Text>
            <Text color={theme.text} bold={active}>
              {row}
            </Text>
            {meta !== '' && <Text color={theme.subtle}> · {meta}</Text>}
          </Box>
        );
      })}
      {augmented.length > slice.length && (
        <Text color={theme.subtle}>
          {'  '}… {augmented.length - slice.length} more
        </Text>
      )}
    </Box>
  );
}

function KeyStep({
  theme,
  value,
  remember,
  provider,
}: {
  theme: Theme;
  value: string;
  remember: boolean;
  provider: ProviderInfo | undefined;
}): React.ReactElement {
  return (
    <Box flexDirection="column">
      {provider?.keyUrl && (
        <Box marginBottom={1}>
          <Text color={theme.subtle}>Get a key at {provider.keyUrl}</Text>
        </Box>
      )}
      <Box>
        <Text color={theme.accent}>{glyphs.caret} </Text>
        {value === '' ? (
          <Text color={theme.subtle}>paste your API key…</Text>
        ) : (
          <Text color={theme.text}>{'•'.repeat(value.length)}</Text>
        )}
      </Box>
      <Box marginTop={1}>
        <Text color={remember ? theme.success : theme.subtle}>
          [{remember ? 'x' : ' '}] remember this key on disk
        </Text>
        <Text color={theme.subtle}> (~/.parallax/credentials.json, mode 600)</Text>
      </Box>
    </Box>
  );
}

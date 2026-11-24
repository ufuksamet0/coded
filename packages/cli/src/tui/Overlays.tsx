import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { CodedConfig, ModeDefinition, ModelInfo, SessionMeta } from '@coded/core';
import { configuredProviders } from '@coded/core';
import { theme } from './theme.js';
import { formatTokens, relativeTime, shortenPath } from './format.js';
import { saveDefaultModel, saveProvider } from '../setup.js';

export function OverlayFrame({
  title,
  subtitle,
  footer,
  children,
}: {
  title: string;
  subtitle?: string;
  footer: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.accent}
      paddingX={1}
      marginTop={1}
    >
      <Box>
        <Text bold color={theme.accentSoft}>
          {title}
        </Text>
        {subtitle ? <Text color={theme.faint}> {subtitle}</Text> : null}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {children}
      </Box>
      <Box marginTop={1}>
        <Text color={theme.faint}>{footer}</Text>
      </Box>
    </Box>
  );
}

function useListKeys(length: number, onSelect: (index: number) => void, onClose: () => void) {
  const [index, setIndex] = useState(0);

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (key.upArrow) {
      setIndex((current) => (length === 0 ? 0 : (current - 1 + length) % length));
      return;
    }
    if (key.downArrow) {
      setIndex((current) => (length === 0 ? 0 : (current + 1) % length));
      return;
    }
    if (key.return && length > 0) {
      onSelect(index);
    }
  });

  return [index, setIndex] as const;
}

export function ModelPicker({
  models,
  current,
  config,
  onSelect,
  onNeedKey,
  onClose,
}: {
  models: ModelInfo[];
  current: string;
  config: CodedConfig;
  onSelect: (ref: string) => void;
  onNeedKey: (providerId: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const configured = useMemo(() => new Set(configuredProviders(config)), [config]);
  const currentIndex = Math.max(
    0,
    models.findIndex((model) => `${model.provider}/${model.id}` === current),
  );
  const [index, setIndex] = useListKeys(
    models.length,
    (selected) => {
      const model = models[selected];
      if (!model) return;
      if (!configured.has(model.provider)) {
        onNeedKey(model.provider);
        return;
      }
      onSelect(`${model.provider}/${model.id}`);
    },
    onClose,
  );

  useEffect(() => {
    setIndex(currentIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = 10;
  const start = Math.max(0, Math.min(index - Math.floor(visible / 2), models.length - visible));
  const slice = models.slice(start, start + visible);

  return (
    <OverlayFrame
      title="Model"
      subtitle={current}
      footer="↑↓ select · enter choose · esc close · /model provider/model for a custom id"
    >
      {start > 0 ? <Text color={theme.faint}>↑ more</Text> : null}
      {slice.map((model, offset) => {
        const absolute = start + offset;
        const selected = absolute === index;
        const ref = `${model.provider}/${model.id}`;
        const ready = configured.has(model.provider);
        return (
          <Box key={ref} flexDirection="column">
            <Box>
              <Text color={selected ? theme.accent : theme.faint}>{selected ? '❯ ' : '  '}</Text>
              <Text color={selected ? theme.accentSoft : ready ? theme.text : theme.muted} bold={selected}>
                {model.label}
              </Text>
              {model.recommended ? <Text color={theme.warning}> ★</Text> : null}
              {!ready ? <Text color={theme.error}> needs key</Text> : null}
            </Box>
            <Box paddingLeft={2}>
              <Text color={theme.faint}>
                {ref} · {formatTokens(model.contextWindow)} ctx
                {model.local ? ' · local' : ''}
              </Text>
            </Box>
          </Box>
        );
      })}
      {start + visible < models.length ? <Text color={theme.faint}>↓ more</Text> : null}
    </OverlayFrame>
  );
}

export function ModePicker({
  modes,
  current,
  onSelect,
  onClose,
}: {
  modes: ModeDefinition[];
  current: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const initial = Math.max(0, modes.findIndex((mode) => mode.id === current));
  const [index, setIndex] = useListKeys(modes.length, (selected) => {
    const mode = modes[selected];
    if (mode) onSelect(mode.id);
  }, onClose);

  useEffect(() => {
    setIndex(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <OverlayFrame title="Mode" subtitle={current} footer="↑↓ select · enter switch · esc close">
      {modes.map((mode, offset) => {
        const selected = offset === index;
        const active = mode.id === current;
        return (
          <Box key={mode.id} flexDirection="column">
            <Box>
              <Text color={selected ? theme.accent : theme.faint}>{selected ? '❯ ' : '  '}</Text>
              <Text color={selected ? theme.accentSoft : theme.text} bold={selected || active}>
                {mode.name}
              </Text>
              {active ? <Text color={theme.success}> ● active</Text> : null}
              <Text color={theme.faint}> · writes {mode.permissions.write}</Text>
            </Box>
            <Box paddingLeft={2}>
              <Text color={theme.faint}>{mode.description}</Text>
            </Box>
          </Box>
        );
      })}
    </OverlayFrame>
  );
}

export function HelpOverlay({ onClose }: { onClose: () => void }): React.JSX.Element {
  useInput((input, key) => {
    if (key.escape || key.return || input === 'q') onClose();
  });

  return (
    <OverlayFrame title="Help" footer="esc close">
      <Text color={theme.accentSoft} bold>
        Commands
      </Text>
      <Box flexDirection="column">
        <HelpRow command="/help" text="Show this help" />
        <HelpRow command="/mode [build|plan]" text="Switch agent mode" />
        <HelpRow command="/model [provider/model]" text="Switch model" />
        <HelpRow command="/keys" text="Add or replace an API key" />
        <HelpRow command="/clear" text="Clear the conversation and screen" />
        <HelpRow command="/compact" text="Drop old context" />
        <HelpRow command="/init" text="Generate AGENTS.md for this project" />
        <HelpRow command="/sessions" text="Browse saved sessions" />
        <HelpRow command="/usage" text="Show token usage" />
        <HelpRow command="/exit" text="Quit" />
      </Box>
      <Box marginTop={1}>
        <Text color={theme.accentSoft} bold>
          Keys
        </Text>
      </Box>
      <HelpRow command="Enter" text="Send the message" />
      <HelpRow command="Ctrl+J / Alt+Enter" text="Insert a new line" />
      <HelpRow command="Shift+Tab" text="Toggle Build / Plan mode" />
      <HelpRow command="Ctrl+C" text="Stop the agent, clear the input, or exit" />
      <HelpRow command="Ctrl+W / Ctrl+U" text="Delete a word / line before the cursor" />
      <HelpRow command="↑ / ↓" text="Input history" />
      <HelpRow command="Ctrl+L" text="Clear the screen" />
      <HelpRow command="@" text="Mention a file (autocomplete)" />
    </OverlayFrame>
  );
}

function HelpRow({ command, text }: { command: string; text: string }): React.JSX.Element {
  return (
    <Box>
      <Box width={24}>
        <Text color={theme.cyan}>{command}</Text>
      </Box>
      <Text color={theme.muted}>{text}</Text>
    </Box>
  );
}

export function SessionPicker({
  sessions,
  onSelect,
  onClose,
}: {
  sessions: SessionMeta[];
  onSelect: (id: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const [index, setIndex] = useListKeys(sessions.length, (selected) => {
    const session = sessions[selected];
    if (session) onSelect(session.id);
  }, onClose);

  const visible = 10;
  const start = Math.max(0, Math.min(index - Math.floor(visible / 2), sessions.length - visible));
  const slice = sessions.slice(start, start + visible);

  return (
    <OverlayFrame
      title="Sessions"
      subtitle={`${sessions.length} saved`}
      footer="↑↓ select · enter resume · esc close"
    >
      {sessions.length === 0 ? (
        <Text color={theme.muted}>No saved sessions for this workspace yet.</Text>
      ) : null}
      {start > 0 ? <Text color={theme.faint}>↑ more</Text> : null}
      {slice.map((session, offset) => {
        const absolute = start + offset;
        const selected = absolute === index;
        return (
          <Box key={session.id} flexDirection="column">
            <Box>
              <Text color={selected ? theme.accent : theme.faint}>{selected ? '❯ ' : '  '}</Text>
              <Text color={selected ? theme.accentSoft : theme.text} bold={selected}>
                {session.title}
              </Text>
            </Box>
            <Box paddingLeft={2}>
              <Text color={theme.faint}>
                {relativeTime(session.updatedAt)} · {session.mode} · {session.model}
              </Text>
            </Box>
          </Box>
        );
      })}
      {start + visible < sessions.length ? <Text color={theme.faint}>↓ more</Text> : null}
    </OverlayFrame>
  );
}

interface ProviderOption {
  id: string;
  name: string;
  description: string;
  env: string;
  defaultModel: string;
  type: 'openai' | 'anthropic' | 'google';
}

const PROVIDERS: ProviderOption[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Claude Opus, Sonnet and Haiku',
    env: 'ANTHROPIC_API_KEY',
    defaultModel: 'anthropic/claude-sonnet-4-5',
    type: 'anthropic',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT-5, GPT-4.1 and o-series',
    env: 'OPENAI_API_KEY',
    defaultModel: 'openai/gpt-4.1',
    type: 'openai',
  },
  {
    id: 'google',
    name: 'Google',
    description: 'Gemini 2.5 Pro and Flash',
    env: 'GEMINI_API_KEY',
    defaultModel: 'google/gemini-2.5-pro',
    type: 'google',
  },
  {
    id: 'local',
    name: 'Local / Ollama',
    description: 'Any OpenAI-compatible server on your machine',
    env: 'OLLAMA_HOST',
    defaultModel: 'local/qwen2.5-coder:7b',
    type: 'openai',
  },
];

export interface SetupResult {
  providerId: string;
  modelRef: string;
}

export function SetupOverlay({
  config,
  initialProvider,
  onComplete,
  onCancel,
}: {
  config: CodedConfig;
  initialProvider?: string;
  onComplete: (result: SetupResult) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const initialIndex = Math.max(
    0,
    PROVIDERS.findIndex((provider) => provider.id === initialProvider),
  );
  const initial = PROVIDERS[initialIndex]!;
  const [providerIndex, setProviderIndex] = useState(initialIndex);
  const [step, setStep] = useState<'provider' | 'key' | 'baseURL' | 'model'>(
    initialProvider ? (initial.id === 'local' ? 'baseURL' : 'key') : 'provider',
  );
  const [text, setText] = useState('');
  const [baseUrl, setBaseUrl] = useState(
    config.providers.local?.baseURL ?? 'http://127.0.0.1:11434/v1',
  );
  const provider = PROVIDERS[providerIndex]!;
  const configured = useMemo(() => new Set(configuredProviders(config)), [config]);

  useEffect(() => {
    if (step === 'baseURL') {
      setText(config.providers.local?.baseURL ?? 'http://127.0.0.1:11434/v1');
    }
    if (step === 'model') {
      setText(provider.defaultModel.split('/').slice(1).join('/'));
    }
  }, [step, config, provider.defaultModel]);

  useInput((input, key) => {
    if (step === 'provider') {
      if (key.escape) return onCancel();
      if (key.upArrow) {
        setProviderIndex((current) => (current - 1 + PROVIDERS.length) % PROVIDERS.length);
        return;
      }
      if (key.downArrow) {
        setProviderIndex((current) => (current + 1) % PROVIDERS.length);
        return;
      }
      if (key.return) {
        const chosen = PROVIDERS[providerIndex]!;
        if (chosen.id === 'local') {
          setText(config.providers.local?.baseURL ?? 'http://127.0.0.1:11434/v1');
          setStep('baseURL');
        } else {
          setText('');
          setStep('key');
        }
      }
      return;
    }

    if (key.escape) {
      setStep('provider');
      setText('');
      return;
    }

    if (key.return) {
      if (step === 'key') {
        const apiKey = text.trim();
        if (!apiKey) return;
        saveProvider(provider.id, { apiKey, type: provider.type });
        saveDefaultModel(provider.defaultModel);
        onComplete({ providerId: provider.id, modelRef: provider.defaultModel });
        return;
      }
      if (step === 'baseURL') {
        const value = text.trim() || 'http://127.0.0.1:11434/v1';
        setBaseUrl(value);
        setStep('model');
        return;
      }
      if (step === 'model') {
        const raw = text.trim() || provider.defaultModel.split('/').slice(1).join('/');
        const modelRef = raw.includes('/') ? raw : `local/${raw}`;
        saveProvider('local', { baseURL: baseUrl, type: 'openai' });
        saveDefaultModel(modelRef);
        onComplete({ providerId: 'local', modelRef });
      }
      return;
    }

    if (key.backspace || key.delete) {
      setText((current) => current.slice(0, -1));
      return;
    }

    if (input && !key.ctrl && !key.meta && !key.tab) {
      const printable = input.replace(/\r/g, '');
      if ([...printable].every((char) => char >= ' ')) {
        setText((current) => current + printable);
      }
    }
  });

  if (step === 'provider') {
    return (
      <OverlayFrame
        title="Connect a model"
        subtitle="Coded is model-agnostic"
        footer="↑↓ select · enter continue · esc quit"
      >
        <Text color={theme.muted}>
          Pick a provider. Keys are saved locally to ~/.coded/config.json with 0600 permissions.
        </Text>
        <Box flexDirection="column" marginTop={1}>
          {PROVIDERS.map((option, index) => {
            const selected = index === providerIndex;
            const ready = configured.has(option.id);
            return (
              <Box key={option.id} flexDirection="column">
                <Box>
                  <Text color={selected ? theme.accent : theme.faint}>{selected ? '❯ ' : '  '}</Text>
                  <Text color={selected ? theme.accentSoft : theme.text} bold={selected}>
                    {option.name}
                  </Text>
                  {ready ? <Text color={theme.success}> ✓ configured</Text> : null}
                </Box>
                <Box paddingLeft={2}>
                  <Text color={theme.faint}>
                    {option.description} · {option.env}
                  </Text>
                </Box>
              </Box>
            );
          })}
        </Box>
      </OverlayFrame>
    );
  }

  const title =
    step === 'key'
      ? `${provider.name} API key`
      : step === 'baseURL'
        ? 'Local model server'
        : 'Local model';

  return (
    <OverlayFrame title={title} footer="enter save · esc back">
      {step === 'key' ? (
        <Box flexDirection="column">
          <Text color={theme.muted}>
            Paste your {provider.name} API key. It is stored locally and never sent anywhere except{' '}
            {provider.name}.
          </Text>
          <Box marginTop={1}>
            <Text color={theme.accent}>❯ </Text>
            <Text color={theme.text}>
              {text ? '•'.repeat(Math.min(text.length, 48)) + (text.length > 48 ? '…' : '') : ''}
            </Text>
            <Text inverse> </Text>
          </Box>
          <Box marginTop={1}>
            <Text color={theme.faint}>
              Tip: set {provider.env} instead and keep the key out of the config file.
            </Text>
          </Box>
        </Box>
      ) : step === 'baseURL' ? (
        <Box flexDirection="column">
          <Text color={theme.muted}>
            The OpenAI-compatible endpoint of your local server. Ollama defaults to
            127.0.0.1:11434.
          </Text>
          <Box marginTop={1}>
            <Text color={theme.accent}>❯ </Text>
            <Text color={theme.text}>{text}</Text>
            <Text inverse> </Text>
          </Box>
          <Box marginTop={1}>
            <Text color={theme.faint}>
              Ollama: ollama serve && ollama pull qwen2.5-coder:7b
            </Text>
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column">
          <Text color={theme.muted}>The model id your server exposes.</Text>
          <Box marginTop={1}>
            <Text color={theme.accent}>❯ </Text>
            <Text color={theme.text}>{text}</Text>
            <Text inverse> </Text>
          </Box>
          <Box marginTop={1}>
            <Text color={theme.faint}>Example: qwen2.5-coder:7b · llama3.3:70b</Text>
          </Box>
        </Box>
      )}
    </OverlayFrame>
  );
}

export function projectLabel(workspace: string): string {
  return shortenPath(workspace, 40);
}

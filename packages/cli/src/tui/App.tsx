import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Static, Text, useApp, useInput, useStdout } from 'ink';
import fg from 'fast-glob';
import {
  Agent,
  CodedError,
  ProviderRegistry,
  SessionStore,
  errorMessage,
  getMode,
  listModels,
  listModes,
  loadConfig,
  parseModelRef,
  type ChatMessage,
  type CodedConfig,
  type ConfirmFn,
  type ModeDefinition,
  type PermissionAnswer,
  type PermissionRequest,
  type SessionData,
  type SessionMeta,
  type ToolCall,
  type ToolResult,
} from '@coded/core';
import { Banner, TranscriptEntry } from './Transcript.js';
import { Markdown } from './Markdown.js';
import { PromptInput } from './PromptInput.js';
import { PermissionPrompt } from './PermissionPrompt.js';
import { StatusBar } from './StatusBar.js';
import {
  HelpOverlay,
  ModePicker,
  ModelPicker,
  SessionPicker,
  SetupOverlay,
  type SetupResult,
} from './Overlays.js';
import { theme, spinnerFrames } from './theme.js';
import { formatTokens, summarizeCall, toolStats, uid } from './format.js';
import type {
  RunningTool,
  StreamingMessage,
  TranscriptItem,
} from './types.js';

type OverlayState =
  | { kind: 'help' }
  | { kind: 'models' }
  | { kind: 'modes' }
  | { kind: 'sessions' }
  | { kind: 'setup'; provider?: string }
  | null;

type Status = 'idle' | 'thinking' | 'streaming' | 'tool' | 'permission';

export interface AppProps {
  workspace: string;
  config: CodedConfig;
  modelRef: string;
  modeId: string;
  version: string;
  yolo?: boolean;
  resume?: SessionData;
  initialPrompt?: string;
  needsSetup?: boolean;
}

const FILE_IGNORES = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/.next/**',
  '**/coverage/**',
  '**/*.lock',
];

export function App(props: AppProps): React.JSX.Element {
  const { exit } = useApp();
  const { stdout } = useStdout();

  const [config, setConfig] = useState<CodedConfig>(props.config);
  const [modelRef, setModelRef] = useState(props.modelRef);
  const [mode, setMode] = useState<ModeDefinition>(() => getMode(props.config, props.modeId));
  const [items, setItems] = useState<TranscriptItem[]>(() => initialItems(props));
  const [streaming, setStreaming] = useState<StreamingMessage | null>(null);
  const [running, setRunning] = useState<RunningTool[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [inputValue, setInputValue] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [permission, setPermission] = useState<PermissionRequest | null>(null);
  const [overlay, setOverlay] = useState<OverlayState>(props.needsSetup ? { kind: 'setup' } : null);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [tokens, setTokens] = useState({ inputTokens: 0, outputTokens: 0 });
  const [staticKey, setStaticKey] = useState(0);
  const [clearSignal, setClearSignal] = useState(0);
  const [busy, setBusy] = useState(false);

  const agentRef = useRef<Agent | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const resolverRef = useRef<((answer: PermissionAnswer) => void) | null>(null);
  const messagesRef = useRef<ChatMessage[]>(props.resume?.messages ?? []);
  const sessionIdRef = useRef<string | undefined>(props.resume?.meta.id);
  const busyRef = useRef(false);
  const turnStartedRef = useRef(Date.now());
  const initialSentRef = useRef(false);
  const tick = useTick(busy);
  const spinner = spinnerFrames[Math.floor(tick / 80) % spinnerFrames.length]!;
  const elapsed = busy ? tick - turnStartedRef.current : 0;

  const addItem = useCallback((item: TranscriptItem) => {
    setItems((current) => [...current, item]);
  }, []);

  const addNotice = useCallback(
    (text: string, tone: 'info' | 'success' | 'warning' = 'info') => {
      addItem({ id: uid('n'), type: 'notice', text, tone });
    },
    [addItem],
  );

  const addError = useCallback(
    (error: unknown) => {
      const message = errorMessage(error);
      let hint: string | undefined;
      if (error instanceof CodedError) {
        if (error.code === 'auth') hint = 'Add a key with /keys, or set the provider environment variable.';
        else if (error.code === 'rate_limit') hint = 'Wait a moment and retry, or switch models with /model.';
        else if (error.code === 'network') hint = 'Check your connection or the provider base URL in ~/.coded/config.json.';
        else if (error.code === 'config') hint = 'Run `coded doctor` to inspect the configuration.';
      }
      addItem({ id: uid('e'), type: 'error', text: message, hint });
      if (error instanceof CodedError && (error.code === 'auth' || error.code === 'config')) {
        const provider = parseModelRef(modelRef).provider;
        setOverlay({ kind: 'setup', provider });
      }
    },
    [addItem, modelRef],
  );

  const confirm = useCallback<ConfirmFn>((request) => {
    return new Promise<PermissionAnswer>((resolve) => {
      resolverRef.current = resolve;
      setPermission(request);
      setStatus('permission');
    });
  }, []);

  const answerPermission = useCallback((answer: PermissionAnswer) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setPermission(null);
    setStatus((current) => (current === 'permission' ? 'thinking' : current));
    resolve?.(answer);
  }, []);

  const makeAgent = useCallback(
    (cfg: CodedConfig, ref: string, activeMode: ModeDefinition, messages: ChatMessage[]): Agent => {
      const registry = new ProviderRegistry(cfg);
      const resolved = registry.resolve(ref);
      return new Agent({
        workspace: props.workspace,
        provider: resolved.provider,
        providerId: resolved.providerId,
        model: resolved.model,
        config: cfg,
        mode: activeMode,
        confirm,
        messages,
        contextWindow: resolved.contextWindow,
        yolo: props.yolo,
      });
    },
    [confirm, props.workspace, props.yolo],
  );

  const ensureAgent = useCallback((): Agent | null => {
    if (agentRef.current) return agentRef.current;
    try {
      const agent = makeAgent(config, modelRef, mode, messagesRef.current);
      agentRef.current = agent;
      return agent;
    } catch (error) {
      addError(error);
      return null;
    }
  }, [addError, config, makeAgent, mode, modelRef]);

  useEffect(() => {
    let cancelled = false;
    fg('**/*', {
      cwd: props.workspace,
      ignore: FILE_IGNORES,
      onlyFiles: true,
      dot: false,
      followSymbolicLinks: false,
    })
      .then((entries) => {
        if (!cancelled) setFiles(entries.sort().slice(0, 4000));
      })
      .catch(() => {
        // File completion is optional.
      });
    return () => {
      cancelled = true;
    };
  }, [props.workspace]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      resolverRef.current?.('deny');
    };
  }, []);

  const persist = useCallback(
    async (agent: Agent) => {
      try {
        const store = new SessionStore(props.workspace);
        const firstUser = agent.messages.find((message) => message.role === 'user');
        const title =
          firstUser && firstUser.role === 'user'
            ? firstUser.content.replace(/\s+/g, ' ').slice(0, 64)
            : 'Untitled session';
        const meta = await store.save(agent.messages, {
          id: sessionIdRef.current,
          title,
          model: modelRef,
          mode: mode.id,
        });
        sessionIdRef.current = meta.id;
      } catch {
        // Session persistence is best effort.
      }
    },
    [mode.id, modelRef, props.workspace],
  );

  const send = useCallback(
    async (text: string) => {
      if (busyRef.current) return;
      const agent = ensureAgent();
      if (!agent) return;

      busyRef.current = true;
      setBusy(true);
      turnStartedRef.current = Date.now();
      addItem({ id: uid('u'), type: 'user', text });
      setHistory((current) => [...current, text]);
      setInputValue('');
      setStatus('thinking');

      const controller = new AbortController();
      abortRef.current = controller;
      let streamId = '';

      try {
        for await (const event of agent.run(text, controller.signal)) {
          switch (event.type) {
            case 'assistant-start': {
              streamId = uid('a');
              setStreaming({ id: streamId, text: '' });
              setStatus('streaming');
              break;
            }
            case 'text': {
              const delta = event.delta ?? '';
              setStreaming((current) =>
                current ? { id: current.id, text: current.text + delta } : { id: streamId || uid('a'), text: delta },
              );
              break;
            }
            case 'assistant-end': {
              setStreaming(null);
              const content = event.message?.role === 'assistant' ? event.message.content : '';
              if (content.trim()) {
                addItem({ id: uid('a'), type: 'assistant', text: content });
              }
              if (event.message?.role === 'assistant' && event.message.toolCalls?.length) {
                setStatus('tool');
              }
              break;
            }
            case 'tool-start': {
              const call = event.call;
              if (!call) break;
              setRunning((current) => [
                ...current,
                {
                  callId: call.id,
                  name: call.name,
                  summary: summarizeCall(call),
                  startedAt: Date.now(),
                },
              ]);
              setStatus('tool');
              break;
            }
            case 'tool-end': {
              const result = event.result;
              const call = event.call;
              if (!result) break;
              setRunning((current) => current.filter((entry) => entry.callId !== result.toolCallId));
              addItem(toolItemFromResult(result, call));
              setStatus('thinking');
              break;
            }
            case 'turn-end': {
              if (event.usage) setTokens(normalizeUsage(event.usage));
              break;
            }
            case 'error': {
              if (event.error) addError(event.error);
              break;
            }
            default:
              break;
          }
        }
      } catch (error) {
        addError(error);
      } finally {
        abortRef.current = null;
        busyRef.current = false;
        setBusy(false);
        setStreaming(null);
        setRunning([]);
        setStatus('idle');
        messagesRef.current = [...agent.messages];
        setTokens(agent.usage);
        void persist(agent);
      }
    },
    [addError, addItem, ensureAgent, persist],
  );

  const abort = useCallback(() => {
    if (resolverRef.current) answerPermission('deny');
    abortRef.current?.abort();
    addNotice('Stopped.');
  }, [addNotice, answerPermission]);

  useEffect(() => {
    if (!props.initialPrompt || initialSentRef.current || overlay) return;
    initialSentRef.current = true;
    void send(props.initialPrompt);
  }, [props.initialPrompt, overlay, send]);

  const clearAll = useCallback(() => {
    if (busyRef.current) {
      addNotice('Stop the current turn before clearing.', 'warning');
      return;
    }
    agentRef.current?.reset();
    agentRef.current = null;
    messagesRef.current = [];
    sessionIdRef.current = undefined;
    setItems([bannerItem(props.workspace, modelRef, props.version)]);
    setStaticKey((current) => current + 1);
    setTokens({ inputTokens: 0, outputTokens: 0 });
    setHistory([]);
    setInputValue('');
    stdout.write('\u001b[2J\u001b[3J\u001b[H');
  }, [addNotice, modelRef, props.version, props.workspace, stdout]);

  const switchMode = useCallback(
    (id: string) => {
      if (busyRef.current) {
        addNotice('Stop the current turn before switching modes.', 'warning');
        return;
      }
      const next = listModes(config).find((candidate) => candidate.id === id);
      if (!next) {
        addNotice(`Unknown mode "${id}". Available: ${listModes(config).map((m) => m.id).join(', ')}`, 'warning');
        return;
      }
      setMode(next);
      agentRef.current?.updateMode(next);
      setOverlay(null);
      addNotice(`Mode: ${next.name} — ${next.description}`, 'success');
    },
    [addNotice, config],
  );

  const toggleMode = useCallback(() => {
    switchMode(mode.id === 'build' ? 'plan' : 'build');
  }, [mode.id, switchMode]);

  const switchModel = useCallback(
    (ref: string) => {
      if (busyRef.current) {
        addNotice('Stop the current turn before switching models.', 'warning');
        return;
      }
      try {
        const next = makeAgent(config, ref, mode, messagesRef.current);
        agentRef.current = next;
        setModelRef(ref);
        setOverlay(null);
        addNotice(`Model: ${ref}`, 'success');
      } catch (error) {
        if (error instanceof CodedError && error.code === 'auth') {
          addNotice('That provider needs an API key.', 'warning');
          setOverlay({ kind: 'setup', provider: parseModelRef(ref).provider });
          return;
        }
        addNotice(errorMessage(error), 'warning');
      }
    },
    [addNotice, config, makeAgent, mode],
  );

  const openSessions = useCallback(async () => {
    const list = await new SessionStore(props.workspace).list();
    setSessions(list);
    setOverlay({ kind: 'sessions' });
  }, [props.workspace]);

  const loadSession = useCallback(
    async (id: string) => {
      try {
        const data = await new SessionStore(props.workspace).load(id);
        setOverlay(null);
        setModelRef(data.meta.model);
        const nextMode = getMode(config, data.meta.mode);
        setMode(nextMode);
        agentRef.current = null;
        messagesRef.current = data.messages;
        sessionIdRef.current = data.meta.id;
        setItems([
          bannerItem(props.workspace, data.meta.model, props.version),
          ...convertMessages(data.messages),
        ]);
        setStaticKey((current) => current + 1);
        setTokens({ inputTokens: 0, outputTokens: 0 });
        addNotice(`Resumed "${data.meta.title}"`, 'success');
      } catch (error) {
        addNotice(errorMessage(error), 'warning');
      }
    },
    [addNotice, config, props.version, props.workspace],
  );

  const handleSetupComplete = useCallback(
    (result: SetupResult) => {
      const nextConfig = loadConfigFromDisk(props.workspace, config);
      setConfig(nextConfig);
      setModelRef(result.modelRef);
      const nextMode = getMode(nextConfig, mode.id);
      setMode(nextMode);
      agentRef.current = null;
      setOverlay(null);
      addNotice(`Connected ${result.providerId} · ${result.modelRef}`, 'success');
    },
    [addNotice, config, mode.id, props.workspace],
  );

  const compact = useCallback(() => {
    const agent = agentRef.current;
    if (!agent || agent.messages.length === 0) {
      addNotice('Nothing to compact yet.');
      return;
    }
    const keep = agent.messages.slice(-8);
    while (keep[0]?.role === 'tool') keep.shift();
    agent.reset();
    agent.messages.push(...keep);
    messagesRef.current = [...agent.messages];
    addNotice(`Compacted context to ${keep.length} messages.`, 'success');
  }, [addNotice]);

  const runCommand = useCallback(
    (raw: string) => {
      const [name, ...rest] = raw.slice(1).trim().split(/\s+/);
      const arg = rest.join(' ').trim();
      switch (name) {
        case 'help':
          setOverlay({ kind: 'help' });
          break;
        case 'mode':
          if (arg) switchMode(arg);
          else setOverlay({ kind: 'modes' });
          break;
        case 'model':
          if (arg) switchModel(arg);
          else setOverlay({ kind: 'models' });
          break;
        case 'keys':
          setOverlay({ kind: 'setup' });
          break;
        case 'clear':
          clearAll();
          break;
        case 'compact':
          compact();
          break;
        case 'init':
          void send(
            'Analyze this repository and write a concise AGENTS.md at the workspace root. Include the project overview, how to build/run/test, code style and conventions, the key directories, and any gotchas. Keep it under 80 lines. Use write_file.',
          );
          break;
        case 'sessions':
          void openSessions();
          break;
        case 'resume':
          if (arg) void loadSession(arg);
          else void openSessions();
          break;
        case 'usage': {
          const total = tokens.inputTokens + tokens.outputTokens;
          addNotice(
            total > 0
              ? `${formatTokens(tokens.inputTokens)} input · ${formatTokens(tokens.outputTokens)} output · ${formatTokens(total)} total`
              : 'No tokens used yet.',
          );
          break;
        }
        case 'exit':
        case 'quit':
          exit();
          break;
        case undefined:
        case '':
          break;
        default:
          addNotice(`Unknown command /${name}. Type /help.`, 'warning');
      }
    },
    [addNotice, clearAll, compact, exit, loadSession, openSessions, send, switchMode, switchModel, tokens],
  );

  const submit = useCallback(
    (text: string) => {
      setInputValue('');
      if (text.startsWith('/')) {
        runCommand(text);
      } else {
        void send(text);
      }
    },
    [runCommand, send],
  );

  useInput(
    (input, key) => {
      if (permission || overlay) return;
      if (key.ctrl && input === 'c') {
        if (busyRef.current) {
          abort();
        } else if (inputValue.length > 0) {
          setInputValue('');
          setClearSignal((current) => current + 1);
        } else {
          exit();
        }
        return;
      }
      if (key.ctrl && input === 'l') {
        clearAll();
        return;
      }
      if (key.ctrl && input === 'd') {
        if (!busyRef.current && inputValue.length === 0) exit();
        return;
      }
      if (key.tab && key.shift) {
        toggleMode();
      }
    },
    { isActive: !permission && !overlay },
  );

  const models = useMemo(() => listModels(config.providers), [config.providers]);
  const modes = useMemo(() => listModes(config), [config]);

  return (
    <>
      <Static key={staticKey} items={items}>
        {(item) => <TranscriptEntry key={item.id} item={item} />}
      </Static>

      <Box flexDirection="column">
        {streaming && streaming.text.length > 0 ? (
          <Box marginTop={1} flexDirection="column">
            <Markdown text={`${streaming.text}▍`} />
          </Box>
        ) : null}

        {running.map((tool) => (
          <Box key={tool.callId} marginTop={1}>
            <Text color={theme.accent}>{spinner} </Text>
            <Text color={theme.text}>{tool.summary}</Text>
            <Text color={theme.faint}> · {formatElapsed(tick - tool.startedAt)}</Text>
          </Box>
        ))}

        {permission ? (
          <PermissionPrompt request={permission} onAnswer={answerPermission} />
        ) : overlay?.kind === 'help' ? (
          <HelpOverlay onClose={() => setOverlay(null)} />
        ) : overlay?.kind === 'models' ? (
          <ModelPicker
            models={models}
            current={modelRef}
            config={config}
            onSelect={switchModel}
            onNeedKey={(provider) => setOverlay({ kind: 'setup', provider })}
            onClose={() => setOverlay(null)}
          />
        ) : overlay?.kind === 'modes' ? (
          <ModePicker
            modes={modes}
            current={mode.id}
            onSelect={switchMode}
            onClose={() => setOverlay(null)}
          />
        ) : overlay?.kind === 'sessions' ? (
          <SessionPicker
            sessions={sessions}
            onSelect={(id) => void loadSession(id)}
            onClose={() => setOverlay(null)}
          />
        ) : overlay?.kind === 'setup' ? (
          <SetupOverlay
            config={config}
            initialProvider={overlay.provider}
            onComplete={handleSetupComplete}
            onCancel={() => setOverlay(null)}
          />
        ) : (
          <Box marginTop={1}>
            <PromptInput
              value={inputValue}
              onChange={setInputValue}
              onSubmit={submit}
              disabled={busy}
              files={files}
              history={history}
              clearSignal={clearSignal}
            />
          </Box>
        )}

        {!overlay ? (
          <StatusBar
            mode={mode}
            model={modelRef}
            inputTokens={tokens.inputTokens}
            outputTokens={tokens.outputTokens}
            busy={busy}
            status={status === 'idle' ? 'thinking' : status}
            running={running[running.length - 1]}
            elapsedMs={elapsed}
            spinner={spinner}
          />
        ) : null}
      </Box>
    </>
  );
}

function initialItems(props: AppProps): TranscriptItem[] {
  const banner = bannerItem(props.workspace, props.modelRef, props.version);
  if (!props.resume) return [banner];
  return [banner, ...convertMessages(props.resume.messages)];
}

function bannerItem(workspace: string, model: string, version: string): TranscriptItem {
  return { id: `banner-${Date.now()}`, type: 'banner', workspace, model, version };
}

function convertMessages(messages: ChatMessage[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const calls = new Map<string, ToolCall>();
  let index = 0;
  for (const message of messages) {
    const id = `resume-${index}`;
    if (message.role === 'user') {
      items.push({ id, type: 'user', text: message.content });
    } else if (message.role === 'assistant') {
      for (const call of message.toolCalls ?? []) calls.set(call.id, call);
      if (message.content.trim()) items.push({ id, type: 'assistant', text: message.content });
    } else {
      const call = calls.get(message.result.toolCallId);
      items.push({
        id,
        type: 'tool',
        callId: message.result.toolCallId,
        name: message.result.name,
        summary: call ? summarizeCall(call) : message.result.name,
        status: message.result.isError ? 'error' : 'done',
        output: message.result.content,
      });
    }
    index += 1;
  }
  return items;
}

function toolItemFromResult(result: ToolResult, call: ToolCall | undefined): TranscriptItem {
  const metadata = result.metadata ?? {};
  return {
    id: uid('t'),
    type: 'tool',
    callId: result.toolCallId,
    name: result.name,
    summary: call ? summarizeCall(call) : result.name,
    status: result.isError ? 'error' : 'done',
    output: result.content,
    diff: typeof metadata.diff === 'string' ? metadata.diff : undefined,
    stats: toolStats(result),
    durationMs: typeof metadata.durationMs === 'number' ? metadata.durationMs : undefined,
  };
}

function useTick(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) {
      setNow(Date.now());
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function normalizeUsage(usage: { inputTokens?: number; outputTokens?: number }): {
  inputTokens: number;
  outputTokens: number;
} {
  return { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0 };
}

function loadConfigFromDisk(workspace: string, fallback: CodedConfig): CodedConfig {
  try {
    return loadConfig({ workspace });
  } catch {
    return fallback;
  }
}

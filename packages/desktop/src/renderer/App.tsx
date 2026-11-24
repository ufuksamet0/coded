import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from './api';
import { Transcript } from './components/Transcript';
import { InputArea } from './components/InputArea';
import { StatusBar } from './components/StatusBar';
import { Sidebar } from './components/Sidebar';
import { PermissionModal } from './components/PermissionModal';
import { SettingsModal } from './components/SettingsModal';
import { WelcomeScreen } from './components/WelcomeScreen';
import { SessionListModal } from './components/SessionListModal';
import { ModelPickerModal } from './components/ModelPickerModal';
import { ModePickerModal } from './components/ModePickerModal';
import type { ChatMessage, ToolCall, ToolResult, CodedConfig, ModeDefinition, AgentEvent } from '@coded/core';

interface TranscriptItem {
  id: string;
  type: 'user' | 'assistant' | 'tool' | 'notice' | 'error' | 'banner';
  text?: string;
  callId?: string;
  name?: string;
  summary?: string;
  status?: 'done' | 'error';
  output?: string;
  diff?: string;
  tone?: 'info' | 'success' | 'warning';
  hint?: string;
}

type OverlayType = 'settings' | 'sessions' | 'models' | 'modes' | null;

export function App() {
  const [workspace, setWorkspace] = useState<string>('');
  const [config, setConfig] = useState<CodedConfig | null>(null);
  const [modelRef, setModelRef] = useState('anthropic/claude-sonnet-4-5');
  const [mode, setMode] = useState<ModeDefinition | null>(null);
  const [items, setItems] = useState<TranscriptItem[]>([]);
  const [streaming, setStreaming] = useState<{ id: string; text: string } | null>(null);
  const [runningTools, setRunningTools] = useState<Array<{ callId: string; name: string; summary: string; startedAt: number }>>([]);
  const [status, setStatus] = useState<'idle' | 'thinking' | 'streaming' | 'tool' | 'permission'>('idle');
  const [busy, setBusy] = useState(false);
  const [tokens, setTokens] = useState({ inputTokens: 0, outputTokens: 0 });
  const [overlay, setOverlay] = useState<OverlayType>(null);
  const [permissionRequest, setPermissionRequest] = useState<any>(null);
  const [agentId, setAgentId] = useState<number | null>(null);
  const [recentWorkspaces, setRecentWorkspaces] = useState<string[]>([]);
  const [showWelcome, setShowWelcome] = useState(true);
  const messagesRef = useRef<ChatMessage[]>([]);
  const turnStartRef = useRef<number>(Date.now());

  const loadConfigAndInit = useCallback(async (ws: string) => {
    try {
      const loadedConfig = await api.loadConfig(ws);
      setConfig(loadedConfig);
      setWorkspace(ws);
      const recent = await api.getRecentWorkspaces();
      setRecentWorkspaces(recent);
      await api.addRecentWorkspace(ws);

      const m = loadedConfig.modes ? Object.values(loadedConfig.modes).find((m: any) => m.id === 'build') : null;
      if (!m && loadedConfig.modes) {
        const modes = Object.values(loadedConfig.modes);
        setMode(modes[0] as ModeDefinition);
      } else if (m) {
        setMode(m as ModeDefinition);
      }

      const handle = await api.agent.create({
        workspace: ws,
        modelRef,
        modeId: mode?.id || 'build',
        config: loadedConfig,
        yolo: false,
        autoApprove: false,
      });
      setAgentId(handle.id);

      setItems([{ id: `banner-${Date.now()}`, type: 'banner', workspace: ws, model: modelRef, version: '0.1.0' }]);
      setShowWelcome(false);
    } catch (error) {
      console.error('Failed to load config:', error);
      addError(error);
    }
  }, [modelRef, mode]);

  useEffect(() => {
    const handleEvent = (event: AgentEvent) => {
      switch (event.type) {
        case 'turn_start':
          setStatus('thinking');
          setBusy(true);
          turnStartRef.current = Date.now();
          break;
        case 'assistant_start':
          setStreaming({ id: `stream-${Date.now()}`, text: '' });
          setStatus('streaming');
          break;
        case 'text':
          setStreaming((current) => current ? { id: current.id, text: current.text + (event.delta || '') } : null);
          break;
        case 'assistant_end':
          setStreaming(null);
          if (event.content?.trim()) {
            addItem({ id: `assistant-${Date.now()}`, type: 'assistant', text: event.content });
          }
          break;
        case 'tool_start':
          if (event.id) {
            setRunningTools((current) => [...current, {
              callId: event.id,
              name: event.name || '',
              summary: summarizeCall(event.name || '', event.input),
              startedAt: Date.now(),
            }]);
            setStatus('tool');
          }
          break;
        case 'tool_end':
          if (event.id) {
            setRunningTools((current) => current.filter((t) => t.callId !== event.id));
            addItem({
              id: `tool-${Date.now()}`,
              type: 'tool',
              callId: event.id,
              name: event.name || '',
              summary: summarizeCall(event.name || '', undefined),
              status: event.isError ? 'error' : 'done',
              output: event.content,
              diff: event.metadata?.diff as string | undefined,
            });
            setStatus('thinking');
          }
          break;
        case 'turn_end':
          if (event.usage) setTokens(event.usage);
          setBusy(false);
          setStatus('idle');
          break;
        case 'error':
          addError(new Error(event.error));
          setBusy(false);
          setStatus('idle');
          break;
        case 'permission':
          setPermissionRequest(event.request);
          setStatus('permission');
          break;
      }
    };

    if (agentId) {
      api.agent.onEvent(agentId, handleEvent);
    }
    return () => {
      // Cleanup would go here
    };
  }, [agentId]);

  const addItem = (item: TranscriptItem) => {
    setItems((current) => [...current, item]);
  };

  const addError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    addItem({ id: `error-${Date.now()}`, type: 'error', text: message });
  };

  const send = async (text: string) => {
    if (!agentId || busy) return;
    addItem({ id: `user-${Date.now()}`, type: 'user', text });
    setBusy(true);
    setStatus('thinking');
    try {
      await api.agent.run(agentId, text);
    } catch (error) {
      addError(error);
      setBusy(false);
      setStatus('idle');
    }
  };

  const answerPermission = (answer: 'allow' | 'always' | 'deny') => {
    if (agentId) {
      api.agent.answerPermission(agentId, answer);
    }
    setPermissionRequest(null);
  };

  const handleNewWorkspace = async () => {
    const ws = await api.pickWorkspace();
    if (ws) {
      await loadConfigAndInit(ws);
    }
  };

  const handleOpenRecent = async (ws: string) => {
    await loadConfigAndInit(ws);
  };

  if (showWelcome || !workspace) {
    return (
      <WelcomeScreen
        recentWorkspaces={recentWorkspaces}
        onNewWorkspace={handleNewWorkspace}
        onOpenRecent={handleOpenRecent}
      />
    );
  }

  return (
    <div className="app">
      <Sidebar
        workspace={workspace}
        modelRef={modelRef}
        mode={mode}
        onModelChange={setModelRef}
        onModeChange={setMode}
        onNewWorkspace={handleNewWorkspace}
        onOpenSettings={() => setOverlay('settings')}
        onOpenSessions={() => setOverlay('sessions')}
        onOpenModels={() => setOverlay('models')}
        onOpenModes={() => setOverlay('modes')}
      />
      <div className="main-content">
        <Transcript
          items={items}
          streaming={streaming}
          runningTools={runningTools}
          busy={busy}
        />
        <StatusBar
          mode={mode}
          model={modelRef}
          tokens={tokens}
          status={status}
          busy={busy}
        />
        <InputArea
          value=""
          onChange={() => {}}
          onSubmit={send}
          disabled={busy || status === 'permission'}
          placeholder={status === 'permission' ? 'Waiting for permission...' : 'Describe a change, ask about the code, or type / for commands'}
        />
      </div>

      {overlay === 'settings' && (
        <SettingsModal
          config={config}
          workspace={workspace}
          onClose={() => setOverlay(null)}
          onEncrypt={api.encrypt}
          onDecrypt={api.decrypt}
        />
      )}
      {overlay === 'sessions' && (
        <SessionListModal
          workspace={workspace}
          onClose={() => setOverlay(null)}
        />
      )}
      {overlay === 'models' && (
        <ModelPickerModal
          config={config}
          current={modelRef}
          onSelect={setModelRef}
          onClose={() => setOverlay(null)}
        />
      )}
      {overlay === 'modes' && (
        <ModePickerModal
          config={config}
          current={mode?.id}
          onSelect={setMode}
          onClose={() => setOverlay(null)}
        />
      )}
      {permissionRequest && (
        <PermissionModal
          request={permissionRequest}
          onAnswer={answerPermission}
        />
      )}
    </div>
  );
}

function summarizeCall(name: string, input?: Record<string, unknown>): string {
  if (!input) return name;
  switch (name) {
    case 'read_file':
    case 'write_file':
    case 'edit_file':
      return `${name} ${input.path || ''}`.trim();
    case 'list_dir':
      return `list_dir ${input.path || '.'}`;
    case 'glob':
      return `glob ${input.pattern || ''}`;
    case 'grep':
      return `grep ${input.pattern || ''}`;
    case 'run_command':
      const cmd = input.command || '';
      return `$ ${cmd.length > 80 ? cmd.slice(0, 77) + '...' : cmd}`;
    default:
      return name;
  }
}
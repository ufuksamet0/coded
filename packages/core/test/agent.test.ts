import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Agent } from '../src/agent/agent.js';
import { getMode } from '../src/agent/modes.js';
import { loadConfig, type CodedConfig } from '../src/config.js';
import type { AgentEvent, Provider, ProviderEvent } from '../src/types.js';

class ScriptedProvider implements Provider {
  readonly id = 'fake';
  readonly name = 'Fake';
  readonly requests: Array<{ messages: number }> = [];

  constructor(private readonly script: ProviderEvent[][]) {}

  async *stream(request: { messages: unknown[] }): AsyncGenerator<ProviderEvent> {
    this.requests.push({ messages: request.messages.length });
    const turn = this.script.shift();
    if (!turn) {
      yield { type: 'text', delta: 'Done.' };
      yield { type: 'done', stopReason: 'stop' };
      return;
    }
    for (const event of turn) yield event;
  }
}

async function collect(agent: Agent, text: string): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of agent.run(text)) events.push(event);
  return events;
}

describe('Agent', () => {
  let workspace: string;
  let config: CodedConfig;

  beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'coded-agent-'));
    await fs.writeFile(path.join(workspace, 'hello.txt'), 'hello world\nsecond line\n', 'utf8');
    config = loadConfig({ workspace, skipFiles: true });
  });

  afterEach(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it('streams a plain assistant reply', async () => {
    const provider = new ScriptedProvider([
      [
        { type: 'text', delta: 'Hi ' },
        { type: 'text', delta: 'there' },
        { type: 'usage', usage: { inputTokens: 10, outputTokens: 2 } },
        { type: 'done', stopReason: 'stop' },
      ],
    ]);
    const agent = new Agent({
      workspace,
      provider,
      providerId: 'fake',
      model: 'fake-1',
      config,
      mode: getMode(config, 'build'),
    });

    const events = await collect(agent, 'hello');
    const text = events.filter((e) => e.type === 'text').map((e) => e.delta).join('');
    expect(text).toBe('Hi there');
    expect(agent.messages).toHaveLength(2);
    expect(agent.messages[1]).toMatchObject({ role: 'assistant', content: 'Hi there' });
    expect(agent.usage).toEqual({ inputTokens: 10, outputTokens: 2 });
  });

  it('executes a read tool and feeds the result back', async () => {
    const provider = new ScriptedProvider([
      [
        { type: 'tool-call', call: { id: 'c1', name: 'read_file', input: { path: 'hello.txt' } } },
        { type: 'done', stopReason: 'tool_calls' },
      ],
      [
        { type: 'text', delta: 'It says hello.' },
        { type: 'done', stopReason: 'stop' },
      ],
    ]);
    const agent = new Agent({
      workspace,
      provider,
      providerId: 'fake',
      model: 'fake-1',
      config,
      mode: getMode(config, 'build'),
    });

    const events = await collect(agent, 'what is in hello.txt?');
    const toolEnd = events.find((e) => e.type === 'tool-end');
    expect(toolEnd?.result?.content).toContain('hello world');
    expect(toolEnd?.result?.isError).toBeFalsy();
    expect(provider.requests).toHaveLength(2);
    expect(agent.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
  });

  it('denies write tools in plan mode and reports it to the model', async () => {
    const provider = new ScriptedProvider([
      [
        {
          type: 'tool-call',
          call: { id: 'c1', name: 'write_file', input: { path: 'new.txt', content: 'x' } },
        },
        { type: 'done', stopReason: 'tool_calls' },
      ],
      [{ type: 'text', delta: 'I cannot write in plan mode.' }, { type: 'done', stopReason: 'stop' }],
    ]);
    const agent = new Agent({
      workspace,
      provider,
      providerId: 'fake',
      model: 'fake-1',
      config,
      mode: getMode(config, 'plan'),
    });

    const events = await collect(agent, 'create a file');
    const toolEnd = events.find((e) => e.type === 'tool-end');
    expect(toolEnd?.result?.isError).toBe(true);
    expect(toolEnd?.result?.content).toContain('Permission denied');
    await expect(fs.access(path.join(workspace, 'new.txt'))).rejects.toThrow();
  });

  it('asks before running a command and honours a denial', async () => {
    const requests: string[] = [];
    const provider = new ScriptedProvider([
      [
        { type: 'tool-call', call: { id: 'c1', name: 'run_command', input: { command: 'echo hi' } } },
        { type: 'done', stopReason: 'tool_calls' },
      ],
      [{ type: 'text', delta: 'Okay.' }, { type: 'done', stopReason: 'stop' }],
    ]);
    const agent = new Agent({
      workspace,
      provider,
      providerId: 'fake',
      model: 'fake-1',
      config,
      mode: getMode(config, 'build'),
      confirm: async (request) => {
        requests.push(request.summary);
        return 'deny';
      },
    });

    const events = await collect(agent, 'run echo');
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain('echo hi');
    const toolEnd = events.find((e) => e.type === 'tool-end');
    expect(toolEnd?.result?.isError).toBe(true);
    expect(toolEnd?.result?.content).toContain('denied');
  });

  it('runs a command when approved', async () => {
    const provider = new ScriptedProvider([
      [
        { type: 'tool-call', call: { id: 'c1', name: 'run_command', input: { command: 'echo coded-ok' } } },
        { type: 'done', stopReason: 'tool_calls' },
      ],
      [{ type: 'text', delta: 'Ran it.' }, { type: 'done', stopReason: 'stop' }],
    ]);
    const agent = new Agent({
      workspace,
      provider,
      providerId: 'fake',
      model: 'fake-1',
      config,
      mode: getMode(config, 'build'),
      confirm: async () => 'allow',
    });

    const events = await collect(agent, 'run echo');
    const toolEnd = events.find((e) => e.type === 'tool-end');
    expect(toolEnd?.result?.isError).toBeFalsy();
    expect(toolEnd?.result?.content).toContain('coded-ok');
  });

  it('edits a file with the edit tool', async () => {
    const provider = new ScriptedProvider([
      [
        {
          type: 'tool-call',
          call: {
            id: 'c1',
            name: 'edit_file',
            input: { path: 'hello.txt', old_string: 'hello world', new_string: 'goodbye world' },
          },
        },
        { type: 'done', stopReason: 'tool_calls' },
      ],
      [{ type: 'text', delta: 'Edited.' }, { type: 'done', stopReason: 'stop' }],
    ]);
    const agent = new Agent({
      workspace,
      provider,
      providerId: 'fake',
      model: 'fake-1',
      config,
      mode: getMode(config, 'build'),
      confirm: async () => 'allow',
    });

    await collect(agent, 'change hello to goodbye');
    expect(await fs.readFile(path.join(workspace, 'hello.txt'), 'utf8')).toContain('goodbye world');
  });

  it('returns an error result for unknown tools', async () => {
    const provider = new ScriptedProvider([
      [
        { type: 'tool-call', call: { id: 'c1', name: 'delete_everything', input: {} } },
        { type: 'done', stopReason: 'tool_calls' },
      ],
      [{ type: 'text', delta: 'Sorry.' }, { type: 'done', stopReason: 'stop' }],
    ]);
    const agent = new Agent({
      workspace,
      provider,
      providerId: 'fake',
      model: 'fake-1',
      config,
      mode: getMode(config, 'build'),
    });

    const events = await collect(agent, 'do it');
    const toolEnd = events.find((e) => e.type === 'tool-end');
    expect(toolEnd?.result?.content).toContain('Unknown tool');
  });

  it('rejects a second concurrent run', async () => {
    const provider = new ScriptedProvider([
      [{ type: 'text', delta: 'one' }, { type: 'done', stopReason: 'stop' }],
      [{ type: 'text', delta: 'two' }, { type: 'done', stopReason: 'stop' }],
    ]);
    const agent = new Agent({
      workspace,
      provider,
      providerId: 'fake',
      model: 'fake-1',
      config,
      mode: getMode(config, 'build'),
    });

    const first = collect(agent, 'one');
    const second = collect(agent, 'two');
    const [, secondEvents] = await Promise.all([first, second]);
    expect(secondEvents[0]?.type).toBe('error');
  });
});

import {
  Agent,
  CodedError,
  ProviderRegistry,
  errorMessage,
  getMode,
  type AgentEvent,
  type CodedConfig,
  type ConfirmFn,
  type PermissionRequest,
  type ToolCall,
  type ToolResult,
} from '@coded/core';
import type { CliOptions } from './args.js';

export interface HeadlessContext {
  workspace: string;
  config: CodedConfig;
  modelRef: string;
  modeId: string;
}

const useColor = process.stderr.isTTY && !process.env.NO_COLOR;
const paint = (code: string, text: string): string =>
  useColor ? `\u001b[${code}m${text}\u001b[0m` : text;
const dim = (text: string) => paint('2', text);
const red = (text: string) => paint('31', text);
const cyan = (text: string) => paint('36', text);

/** One-line, human summary of a tool call for stderr progress. */
function describeCall(call: ToolCall): string {
  const input = call.input ?? {};
  const pick = (key: string): string | undefined => {
    const value = input[key];
    return typeof value === 'string' ? value : undefined;
  };
  switch (call.name) {
    case 'read_file':
    case 'write_file':
    case 'edit_file':
      return `${call.name} ${pick('path') ?? ''}`.trim();
    case 'list_dir':
      return `list_dir ${pick('path') ?? '.'}`;
    case 'glob':
      return `glob ${pick('pattern') ?? ''}`;
    case 'grep':
      return `grep ${pick('pattern') ?? ''}`;
    case 'run_command': {
      const command = pick('command') ?? '';
      return `$ ${command.length > 100 ? `${command.slice(0, 97)}…` : command}`;
    }
    default:
      return call.name;
  }
}

function describeResult(result: ToolResult): string {
  const meta = result.metadata ?? {};
  if (typeof meta.exitCode === 'number') return `exit ${meta.exitCode}`;
  if (typeof meta.bytes === 'number') return `${meta.bytes} bytes`;
  if (typeof meta.count === 'number') return `${meta.count} matches`;
  if (result.isError) return 'error';
  return 'done';
}

function permissionRefusal(request: PermissionRequest): string {
  return (
    `Blocked ${request.category} action: ${request.summary}. ` +
    'Re-run with --yes to approve tool actions automatically.'
  );
}

export async function runHeadless(options: CliOptions, context: HeadlessContext): Promise<number> {
  const { workspace, config, modelRef, modeId } = context;
  const prompt = options.prompt?.trim();

  if (!prompt) {
    process.stderr.write(red('No prompt given.') + ' Use -p "<prompt>" or pipe text on stdin.\n');
    return 1;
  }

  const mode = getMode(config, modeId);
  const registry = new ProviderRegistry(config);

  const confirm: ConfirmFn = async (request) => {
    process.stderr.write(`${dim(permissionRefusal(request))}\n`);
    return 'deny';
  };

  let agent: Agent;
  try {
    const resolved = registry.resolve(modelRef);
    agent = new Agent({
      workspace,
      provider: resolved.provider,
      providerId: resolved.providerId,
      model: resolved.model,
      config,
      mode,
      confirm,
      contextWindow: resolved.contextWindow,
      yolo: options.yolo,
      autoApprove: options.yes,
    });
  } catch (error) {
    process.stderr.write(`${red('error:')} ${errorMessage(error)}\n`);
    return 1;
  }

  const controller = new AbortController();
  let interrupted = false;
  const onSignal = (): void => {
    interrupted = true;
    controller.abort();
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  let wroteText = false;
  let failed = false;

  const emitJson = (event: Record<string, unknown>): void => {
    process.stdout.write(`${JSON.stringify(event)}\n`);
  };

  const startText = (): void => {
    if (options.json) return;
    if (wroteText) return;
    wroteText = true;
  };

  const onEvent = (event: AgentEvent): void => {
    switch (event.type) {
      case 'turn-start':
        if (options.json) emitJson({ type: 'turn_start' });
        break;
      case 'assistant-start':
        if (options.json) emitJson({ type: 'assistant_start' });
        break;
      case 'text': {
        const delta = event.delta ?? '';
        if (!delta) break;
        if (options.json) {
          emitJson({ type: 'text', delta });
        } else {
          startText();
          process.stdout.write(delta);
        }
        break;
      }
      case 'assistant-end':
        if (options.json) {
          emitJson({
            type: 'assistant_end',
            content: event.message?.role === 'assistant' ? event.message.content : '',
          });
        } else if (wroteText) {
          process.stdout.write('\n');
          wroteText = false;
        }
        break;
      case 'tool-start': {
        if (!event.call) break;
        if (options.json) {
          emitJson({ type: 'tool_start', id: event.call.id, name: event.call.name, input: event.call.input });
        } else {
          if (wroteText) {
            process.stdout.write('\n');
            wroteText = false;
          }
          process.stderr.write(`${cyan('→')} ${describeCall(event.call)}\n`);
        }
        break;
      }
      case 'tool-end': {
        if (!event.result) break;
        if (options.json) {
          emitJson({
            type: 'tool_end',
            id: event.result.toolCallId,
            name: event.result.name,
            content: event.result.content,
            isError: Boolean(event.result.isError),
            metadata: event.result.metadata ?? {},
          });
        } else {
          process.stderr.write(`${dim(`  ← ${describeResult(event.result)}`)}\n`);
        }
        break;
      }
      case 'turn-end':
        if (options.json && event.usage) {
          emitJson({ type: 'usage', inputTokens: event.usage.inputTokens, outputTokens: event.usage.outputTokens });
        }
        break;
      case 'error': {
        failed = true;
        if (options.json) {
          emitJson({
            type: 'error',
            message: errorMessage(event.error),
            code: event.error instanceof CodedError ? event.error.code : 'unknown',
          });
        } else {
          if (wroteText) {
            process.stdout.write('\n');
            wroteText = false;
          }
          process.stderr.write(`${red('error:')} ${errorMessage(event.error)}\n`);
        }
        break;
      }
      default:
        break;
    }
  };

  try {
    for await (const event of agent.run(prompt, controller.signal)) {
      onEvent(event);
    }
  } catch (error) {
    failed = true;
    if (options.json) {
      emitJson({
        type: 'error',
        message: errorMessage(error),
        code: error instanceof CodedError ? error.code : 'unknown',
      });
    } else {
      if (wroteText) process.stdout.write('\n');
      process.stderr.write(`${red('error:')} ${errorMessage(error)}\n`);
    }
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }

  if (options.json) {
    emitJson({
      type: 'done',
      interrupted,
      usage: agent.usage,
      messages: agent.messages.length,
    });
  } else if (wroteText) {
    process.stdout.write('\n');
  }

  if (interrupted) return 130;
  return failed ? 1 : 0;
}

#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import React from 'react';
import { render } from 'ink';
import {
  CodedError,
  DEFAULT_MODEL,
  ProviderRegistry,
  SessionStore,
  errorMessage,
  getMode,
  listModels,
  listModes,
  loadConfig,
  parseModelRef,
  sessionsDir,
  type CodedConfig,
  type SessionData,
} from '@coded/core';
import { HELP, parseArgs, type CliOptions } from './args.js';
import { App } from './tui/App.js';
import { runHeadless } from './headless.js';
import {
  globalConfigPath,
  initProjectConfig,
  maskKey,
  resolveWorkspace,
} from './setup.js';

function readVersion(): string {
  try {
    const file = new URL('../package.json', import.meta.url);
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { version?: string };
    return parsed.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const VERSION = readVersion();

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string, text: string): string => (color ? `\u001b[${code}m${text}\u001b[0m` : text);
const bold = (text: string) => paint('1', text);
const dim = (text: string) => paint('2', text);
const green = (text: string) => paint('32', text);
const red = (text: string) => paint('31', text);
const yellow = (text: string) => paint('33', text);
const cyan = (text: string) => paint('36', text);

function printHelp(): void {
  process.stdout.write(HELP);
}

function providerStatus(config: CodedConfig): Array<{ id: string; ready: boolean; detail: string }> {
  return Object.entries(config.providers).map(([id, provider]) => {
    const local = id === 'local' || /127\.0\.0\.1|localhost/.test(provider.baseURL ?? '');
    const ready = Boolean(provider.apiKey) || local;
    const detail = provider.apiKey
      ? maskKey(provider.apiKey)
      : local
        ? provider.baseURL ?? 'local endpoint'
        : 'no API key';
    return { id, ready, detail };
  });
}

function commandModels(config: CodedConfig): number {
  const models = listModels(config.providers);
  const status = new Map(providerStatus(config).map((entry) => [entry.id, entry]));
  const providers = [...new Set(models.map((model) => model.provider))];

  process.stdout.write(`${bold('Models')} ${dim('— provider/model')}\n\n`);
  for (const provider of providers) {
    const entry = status.get(provider);
    const marker = entry ? (entry.ready ? green('●') : yellow('○')) : yellow('○');
    const note = entry ? dim(`  ${entry.ready ? 'ready' : 'no key'} · ${entry.detail}`) : dim('  not configured');
    process.stdout.write(`${marker} ${bold(provider)}${note}\n`);
    for (const model of models.filter((candidate) => candidate.provider === provider)) {
      const tags = [
        model.recommended ? green('recommended') : '',
        model.local ? dim('local') : '',
        dim(`${Math.round(model.contextWindow / 1000)}k ctx`),
      ].filter(Boolean);
      process.stdout.write(`   ${model.id}  ${dim(model.label)}  ${tags.join(' · ')}\n`);
    }
    process.stdout.write('\n');
  }
  process.stdout.write(
    dim(`Use -m provider/model, or set "model" in ${globalConfigPath()}.\n`),
  );
  return 0;
}

function commandInit(workspace: string): number {
  const file = initProjectConfig(workspace);
  const relative = path.relative(workspace, file) || file;
  process.stdout.write(`${green('✓')} Project config at ${bold(relative)}\n`);
  process.stdout.write(dim('  Commit it to share permissions and modes with your team.\n'));
  return 0;
}

function checkGit(workspace: string): string | undefined {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: workspace, encoding: 'utf8' });
  if (result.status !== 0) return undefined;
  return result.stdout.trim();
}

function commandDoctor(workspace: string, config: CodedConfig, modelRef: string): number {
  const lines: string[] = [];
  const ok = (label: string, detail?: string): void => {
    lines.push(`${green('✓')} ${label}${detail ? dim(`  ${detail}`) : ''}`);
  };
  const warn = (label: string, detail?: string): void => {
    lines.push(`${yellow('!')} ${label}${detail ? dim(`  ${detail}`) : ''}`);
  };
  const bad = (label: string, detail?: string): void => {
    lines.push(`${red('✗')} ${label}${detail ? dim(`  ${detail}`) : ''}`);
  };

  const major = Number(process.versions.node.split('.')[0] ?? 0);
  if (major >= 20) ok('Node.js', process.version);
  else bad('Node.js', `${process.version} — version 20 or newer is required`);

  if (fs.existsSync(workspace) && fs.statSync(workspace).isDirectory()) ok('Workspace', workspace);
  else bad('Workspace', `${workspace} is not a directory`);

  const gitRoot = checkGit(workspace);
  if (gitRoot) ok('Git repository', gitRoot);
  else warn('Git repository', 'not inside a git work tree');

  if (config.sources.length > 0) {
    for (const source of config.sources) ok('Config', source);
  } else {
    warn('Config', `no config files yet (${globalConfigPath()})`);
  }

  for (const provider of providerStatus(config)) {
    if (provider.ready) ok(`Provider ${provider.id}`, provider.detail);
    else warn(`Provider ${provider.id}`, 'no API key — run `coded` and use /keys');
  }

  const parsed = parseModelRef(modelRef);
  const modelProvider = providerStatus(config).find((entry) => entry.id === parsed.provider);
  if (!config.providers[parsed.provider]) {
    bad('Model', `${modelRef} — provider "${parsed.provider}" is not configured`);
  } else if (modelProvider && !modelProvider.ready) {
    bad('Model', `${modelRef} — provider "${parsed.provider}" has no API key`);
  } else {
    ok('Model', modelRef);
  }

  const modes = listModes(config).map((mode) => mode.id);
  ok('Modes', modes.join(', '));

  try {
    fs.mkdirSync(sessionsDir(), { recursive: true });
    fs.accessSync(sessionsDir(), fs.constants.W_OK);
    ok('Sessions', sessionsDir());
  } catch (error) {
    warn('Sessions', `cannot write ${sessionsDir()}: ${errorMessage(error)}`);
  }

  process.stdout.write(`${bold('coded doctor')} ${dim(`v${VERSION}`)}\n\n`);
  process.stdout.write(`${lines.join('\n')}\n`);

  const problems = lines.filter((line) => line.startsWith('✗')).length;
  process.stdout.write(
    problems === 0
      ? `\n${green('Ready.')} ${dim('Run `coded` to start.')}\n`
      : `\n${red(`${problems} problem${problems === 1 ? '' : 's'} found.`)}\n`,
  );
  return problems === 0 ? 0 : 1;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function loadResume(workspace: string, options: CliOptions): Promise<SessionData | undefined> {
  if (options.resume === undefined && !options.continueSession) return undefined;
  const store = new SessionStore(workspace);
  try {
    if (typeof options.resume === 'string' && options.resume.length > 0) {
      return await store.load(options.resume);
    }
    const sessions = await store.list();
    if (sessions.length === 0) {
      process.stderr.write(dim('No saved sessions for this project.\n'));
      return undefined;
    }
    return await store.load(sessions[0]!.id);
  } catch (error) {
    process.stderr.write(`${yellow('!')} ${errorMessage(error)}\n`);
    return undefined;
  }
}

async function main(): Promise<number> {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${red('error:')} ${errorMessage(error)}\n\n`);
    process.stderr.write(HELP);
    return 1;
  }

  if (options.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (options.help || options.command === 'help') {
    printHelp();
    return 0;
  }

  const workspace = resolveWorkspace(options.cwd);

  let config: CodedConfig;
  try {
    config = loadConfig({ workspace });
  } catch (error) {
    process.stderr.write(`${red('error:')} ${errorMessage(error)}\n`);
    return 1;
  }

  if (options.command === 'init') return commandInit(workspace);
  if (options.command === 'models') return commandModels(config);

  const resume = await loadResume(workspace, options);
  const modelRef = options.model ?? resume?.meta.model ?? config.model ?? DEFAULT_MODEL;
  const requestedMode = options.mode ?? resume?.meta.mode ?? 'build';
  if (!listModes(config).some((mode) => mode.id === requestedMode)) {
    process.stderr.write(
      `${red('error:')} Unknown mode "${requestedMode}". Available: ${listModes(config)
        .map((mode) => mode.id)
        .join(', ')}\n`,
    );
    return 1;
  }

  if (options.command === 'doctor') return commandDoctor(workspace, config, modelRef);

  // Headless when a prompt is supplied, output is piped, or JSON is requested.
  const piped = !process.stdin.isTTY;
  let prompt = options.prompt;
  if (piped) {
    const input = await readStdin();
    if (input.trim()) {
      prompt = prompt && prompt !== '-' ? `${prompt}\n\n${input.trim()}` : input.trim();
    }
  }

  if (prompt || options.json) {
    return runHeadless({ ...options, prompt }, { workspace, config, modelRef, modeId: requestedMode });
  }

  if (!process.stdout.isTTY) {
    process.stderr.write(
      `${red('error:')} Not a terminal. Use -p "<prompt>" for non-interactive output.\n`,
    );
    return 1;
  }

  // Decide whether the first screen should be onboarding.
  let needsSetup = false;
  try {
    new ProviderRegistry(config).resolve(modelRef);
  } catch (error) {
    if (error instanceof CodedError && (error.code === 'auth' || error.code === 'config')) needsSetup = true;
  }

  const app = render(
    React.createElement(App, {
      workspace,
      config,
      modelRef,
      modeId: requestedMode,
      version: VERSION,
      yolo: options.yolo,
      resume,
      initialPrompt: options.prompt,
      needsSetup,
    }),
    { exitOnCtrlC: false },
  );

  await app.waitUntilExit();
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`${red('error:')} ${errorMessage(error)}\n`);
    if (error instanceof CodedError && error.cause) {
      process.stderr.write(dim(`${String((error.cause as Error).message ?? error.cause)}\n`));
    }
    process.exitCode = 1;
  });

// Keep the process alive until Ink releases the terminal, and exit cleanly if
// the renderer closes early.
process.on('unhandledRejection', (reason) => {
  process.stderr.write(`${red('error:')} ${errorMessage(reason)}\n`);
  process.exitCode = 1;
});

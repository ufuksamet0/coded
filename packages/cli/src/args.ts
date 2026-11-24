export type CliCommand = 'init' | 'doctor' | 'models' | 'help';

export interface CliOptions {
  command?: CliCommand;
  prompt?: string;
  json: boolean;
  mode?: string;
  model?: string;
  yolo: boolean;
  yes: boolean;
  cwd?: string;
  resume?: string | true;
  continueSession: boolean;
  help: boolean;
  version: boolean;
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    json: false,
    yolo: false,
    yes: false,
    continueSession: false,
    help: false,
    version: false,
  };
  const positional: string[] = [];
  const commands = new Set(['init', 'doctor', 'models', 'help']);

  if (argv[0] && commands.has(argv[0])) {
    options.command = argv[0] as CliCommand;
    argv = argv.slice(1);
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const next = (): string => {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`Missing value for ${arg}`);
      i += 1;
      return value;
    };

    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--version' || arg === '-v') {
      options.version = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--yolo' || arg === '--dangerously-skip-permissions') {
      options.yolo = true;
    } else if (arg === '--yes' || arg === '-y') {
      options.yes = true;
    } else if (arg === '--continue' || arg === '-c') {
      options.continueSession = true;
    } else if (arg === '--print' || arg === '-p') {
      options.prompt = next();
    } else if (arg.startsWith('--print=')) {
      options.prompt = arg.slice(8);
    } else if (arg === '--mode') {
      options.mode = next();
    } else if (arg.startsWith('--mode=')) {
      options.mode = arg.slice(7);
    } else if (arg === '--model' || arg === '-m') {
      options.model = next();
    } else if (arg.startsWith('--model=')) {
      options.model = arg.slice(8);
    } else if (arg === '--cwd') {
      options.cwd = next();
    } else if (arg.startsWith('--cwd=')) {
      options.cwd = arg.slice(6);
    } else if (arg === '--resume') {
      const value = argv[i + 1];
      if (value && !value.startsWith('-')) {
        options.resume = value;
        i += 1;
      } else {
        options.resume = true;
      }
    } else if (arg.startsWith('--resume=')) {
      options.resume = arg.slice(9);
    } else if (arg.startsWith('-') && arg !== '-') {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  if (!options.prompt && positional.length > 0) {
    options.prompt = positional.join(' ');
  }
  return options;
}

export const HELP = `coded — an AI coding agent in your terminal

Usage
  coded                       Start the interactive TUI
  coded "fix the failing test" Start with a first message
  coded -p "explain src/"     Non-interactive: print the answer and exit
  cat file | coded -p "review this"

Commands
  coded init                  Write a project config at .coded/config.json
  coded models                List known models and providers
  coded doctor                Check keys, tools and configuration

Options
  -m, --model <provider/model>  Model to use (e.g. anthropic/claude-sonnet-4-5)
      --mode <build|plan>       Start in a specific mode
  -p, --print <prompt>          Non-interactive mode, prints to stdout
      --json                    With --print: emit newline-delimited JSON events
  -y, --yes                     Auto-approve tool actions (non-interactive)
      --yolo                    Skip every permission prompt (dangerous)
  -c, --continue                Resume the most recent session
      --resume [id]             Resume a session by id, or pick one
      --cwd <dir>               Workspace directory (default: current)
  -h, --help                    Show this help
  -v, --version                 Show the version

Keys
  Enter          Send                  Shift+Tab   Switch mode
  Ctrl+J         New line              Ctrl+C      Stop / clear / exit
  ↑ / ↓          History               Ctrl+W      Delete word
  /              Commands              @           Mention a file
  Ctrl+L         Clear screen          Esc         Close overlay
`;

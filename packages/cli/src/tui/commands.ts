export interface SlashCommand {
  name: string;
  args?: string;
  description: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: 'help', description: 'Show commands and keyboard shortcuts' },
  { name: 'mode', args: '[build|plan]', description: 'Switch agent mode' },
  { name: 'model', args: '[provider/model]', description: 'Switch model' },
  { name: 'keys', description: 'Add or replace an API key' },
  { name: 'clear', description: 'Clear the conversation and screen' },
  { name: 'compact', description: 'Drop old context to free tokens' },
  { name: 'init', description: 'Generate an AGENTS.md for this project' },
  { name: 'sessions', description: 'Browse saved sessions' },
  { name: 'resume', args: '[id]', description: 'Resume a saved session' },
  { name: 'usage', description: 'Show token usage for this session' },
  { name: 'exit', description: 'Quit Coded' },
];

export function filterCommands(query: string): SlashCommand[] {
  const normalized = query.toLowerCase();
  return SLASH_COMMANDS.filter(
    (command) =>
      command.name.startsWith(normalized) ||
      command.description.toLowerCase().includes(normalized),
  ).slice(0, 8);
}

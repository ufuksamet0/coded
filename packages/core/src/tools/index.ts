import type { CodedConfig } from '../config.js';
import type { ModeDefinition, ToolDefinition } from '../types.js';
import { createReadTools, createWriteTools } from './fs.js';
import { createShellTools } from './shell.js';

export interface ToolRegistry {
  all: Map<string, ToolDefinition>;
  forMode(mode: ModeDefinition): ToolDefinition[];
  get(name: string): ToolDefinition | undefined;
}

export function createToolRegistry(config: CodedConfig): ToolRegistry {
  const tools = [
    ...createReadTools(),
    ...createWriteTools(),
    ...createShellTools({ defaultTimeoutMs: config.limits.commandTimeoutMs }),
  ];
  const all = new Map(tools.map((tool) => [tool.name, tool]));

  return {
    all,
    get: (name) => all.get(name),
    forMode(mode) {
      if (mode.tools === '*') return tools;
      const allowed = new Set(mode.tools);
      return tools.filter((tool) => allowed.has(tool.name));
    },
  };
}

export function toolNamesForMode(registry: ToolRegistry, mode: ModeDefinition): string[] {
  return registry.forMode(mode).map((tool) => tool.name);
}

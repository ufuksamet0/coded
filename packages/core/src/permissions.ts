import type { CodedConfig } from './config.js';
import type {
  ConfirmFn,
  ModeDefinition,
  PermissionAnswer,
  PermissionCategory,
  PermissionRequest,
  ToolDefinition,
  ToolPreview,
} from './types.js';
import type { ToolContext } from './types.js';

export interface PermissionEngineOptions {
  mode: ModeDefinition;
  config: CodedConfig;
  confirm?: ConfirmFn;
  /** Skip every prompt. Only for explicit --yolo / desktop "trust" mode. */
  yolo?: boolean;
  /** Non-interactive runs may pre-approve everything they were allowed to run. */
  autoApprove?: boolean;
  /** Called after every decision, useful for auditing. */
  onDecision?: (request: PermissionRequest, answer: PermissionAnswer) => void;
}

export interface AuthorizationResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Single place where "can this tool run?" is decided. The mode supplies the
 * baseline policy, project config can allow/deny tools, and the user can grant
 * per-session approval through the confirm callback.
 */
export class PermissionEngine {
  private readonly alwaysAllowed = new Set<string>();
  private mode: ModeDefinition;
  private readonly config: CodedConfig;
  private readonly confirm?: ConfirmFn;

  constructor(private readonly options: PermissionEngineOptions) {
    this.mode = options.mode;
    this.config = options.config;
    this.confirm = options.confirm;
  }

  updateMode(mode: ModeDefinition): void {
    this.mode = mode;
  }

  async authorize(
    tool: ToolDefinition,
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<AuthorizationResult> {
    if (this.isDeniedByConfig(tool)) {
      return { allowed: false, reason: `The project config denies "${tool.name}".` };
    }
    if (this.mode.tools !== '*' && !this.mode.tools.includes(tool.name)) {
      const readOnlyNote =
        tool.category === 'write' ? ` ${this.mode.name} mode is read-only; switch to Build mode to edit files.` : '';
      return {
        allowed: false,
        reason: `Tool "${tool.name}" is not available in ${this.mode.name} mode.${readOnlyNote}`,
      };
    }
    if (this.isAllowedByConfig(tool) || this.mode.autoAllow?.includes(tool.name)) {
      return { allowed: true };
    }

    const policy = this.mode.permissions[tool.category] ?? 'ask';
    if (policy === 'allow') return { allowed: true };
    if (policy === 'deny') return { allowed: false, reason: this.denyReason(tool.category) };

    if (this.alwaysAllowed.has(tool.name)) return { allowed: true };
    if (this.options.yolo || this.options.autoApprove) return { allowed: true };

    if (!this.confirm) {
      return {
        allowed: false,
        reason: `"${tool.name}" needs approval, but this is a non-interactive session. Re-run with --yes to allow it.`,
      };
    }

    const preview = await this.preview(tool, input, ctx);
    const request: PermissionRequest = {
      tool: tool.name,
      category: tool.category,
      input,
      summary: preview.summary,
      diff: preview.diff,
      reason: preview.reason,
      warning: preview.warning,
    };

    const answer = await this.confirm(request);
    this.options.onDecision?.(request, answer);
    if (answer === 'allow') return { allowed: true };
    if (answer === 'always') {
      this.alwaysAllowed.add(tool.name);
      return { allowed: true };
    }
    return { allowed: false, reason: 'The user denied this action.' };
  }

  resetSessionApprovals(): void {
    this.alwaysAllowed.clear();
  }

  private async preview(
    tool: ToolDefinition,
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolPreview> {
    if (!tool.preview) return { summary: `${tool.name} ${summarizeInput(input)}`.trim() };
    try {
      return await tool.preview(input, ctx);
    } catch {
      return { summary: `${tool.name} ${summarizeInput(input)}`.trim() };
    }
  }

  private isDeniedByConfig(tool: ToolDefinition): boolean {
    const deny = this.config.permissions.deny;
    return deny.includes(tool.name) || deny.includes(tool.category);
  }

  private isAllowedByConfig(tool: ToolDefinition): boolean {
    const allow = this.config.permissions.allow;
    return allow.includes(tool.name) || allow.includes(tool.category);
  }

  private denyReason(category: PermissionCategory): string {
    if (category === 'write') {
      return `${this.mode.name} mode is read-only. Switch to Build mode to edit files.`;
    }
    return `${this.mode.name} mode does not allow ${category} actions.`;
  }
}

function summarizeInput(input: Record<string, unknown>): string {
  const entries = Object.entries(input)
    .filter(([, value]) => value !== undefined)
    .slice(0, 3)
    .map(([key, value]) => {
      const rendered = typeof value === 'string' ? value : JSON.stringify(value);
      return `${key}=${rendered.length > 60 ? `${rendered.slice(0, 60)}…` : rendered}`;
    });
  return entries.join(' ');
}

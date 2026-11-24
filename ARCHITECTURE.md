# Architecture

## Overview

Coded is a monorepo with three packages:

```
packages/
├── core/          # Agent runtime (provider-agnostic)
├── cli/           # Terminal TUI (Ink + React)
└── desktop/       # Desktop app (Electron + React + Vite)
```

## Core Package (`@coded/core`)

The core package contains all provider-agnostic logic:

### Agent Loop (`agent/agent.ts`)

The `Agent` class is the central orchestration component:

- **Provider-agnostic**: Works with any provider implementing the `Provider` interface
- **Event-driven**: Yields `AgentEvent` types (`turn-start`, `assistant-start`, `text`, `assistant-end`, `tool-start`, `tool-end`, `turn-end`, `error`)
- **Streaming**: Handles streaming responses from providers
- **Tool execution**: Executes tool calls with permission checks
- **Context management**: Trims/compresses conversation history to fit context window
- **Usage tracking**: Tracks input/output tokens across turns

### Providers (`providers/`)

Each provider implements the `Provider` interface:

```typescript
interface Provider {
  readonly id: string;
  readonly name: string;
  stream(request: ChatRequest): AsyncGenerator<ProviderEvent, void, unknown>;
}
```

- **OpenAIProvider**: OpenAI-compatible (`/chat/completions` with SSE)
- **AnthropicProvider**: Anthropic (`/v1/messages` with SSE)
- **GoogleProvider**: Google Gemini (`streamGenerateContent?alt=sse`)

The `ProviderRegistry` resolves model references (e.g., `anthropic/claude-sonnet-4-5`) to provider instances.

### Tools (`tools/`)

Tools are defined with JSON Schema parameters and executed via the `ToolRegistry`:

| Tool | Description |
|------|-------------|
| `read_file` | Read file contents with optional offset/limit |
| `write_file` | Write new file or overwrite existing |
| `edit_file` | Surgical edits with unified diff preview |
| `list_dir` | List directory contents |
| `glob` | Glob pattern matching |
| `grep` | Ripgrep-style search |
| `run_command` | Execute shell commands with timeout |

Tools return `ToolResult` with optional metadata (diff, exit code, duration).

### Permissions (`permissions.ts`)

The `PermissionEngine` evaluates tool calls against policies:

- **Categories**: `read`, `write`, `shell`, `network`
- **Policies**: `allow`, `ask`, `deny`
- **Session "always allow"**: User can grant permanent permission for a tool in the current session
- **Config allow/deny lists**: Glob patterns for auto-allow/deny
- **Auto-allow**: Tools like `read_file`, `list_dir` can be auto-allowed even in `ask` mode
- **Yolo mode**: Skip all prompts (`--yolo` flag)
- **Auto-approve**: Non-interactive approval (`--yes` flag)

### Configuration (`config.ts`)

Layered config system:

1. Global: `~/.coded/config.json`
2. Project: `.coded/config.json`
3. Explicit: `CODED_CONFIG` env var
4. Environment overrides: `CODED_MODEL`, `CODED_THEME`

Supports `env:VAR` and `$VAR` references for secrets.

### Sessions (`agent/session.ts`)

`SessionStore` persists conversations:

- Location: `~/.coded/sessions/<project-key>/`
- Atomic writes with temp files
- Each session: `messages[]` + `meta{id, title, model, mode, timestamps}`

### Utilities (`utils/`)

- `paths.ts`: Path resolution, sandboxing (`resolveInside`), config/sessions directories
- `text.ts`: Token estimation, truncation
- `diff.ts`: Unified diff generation
- `sse.ts`: Server-Sent Events parsing

## CLI Package (`@coded/cli`)

### TUI Architecture (`src/tui/`)

Built with **Ink 8** + **React 19**:

```
App.tsx          # Main state machine, event loop
├── Transcript.tsx    # Rendered conversation (Static + dynamic)
├── PromptInput.tsx   # Custom editor (history, completions, multiline)
├── PermissionPrompt.tsx  # Approval modal with diff preview
├── Overlays.tsx      # Help, ModelPicker, ModePicker, SessionPicker, Setup
├── StatusBar.tsx     # Mode, model, tokens, status, shortcuts
├── DiffView.tsx      # Unified diff rendering
├── Markdown.tsx      # Minimal markdown (code, bold, italic)
├── format.ts         # Token formatting, call summaries
└── theme.ts          # Color palette
```

### Key Design Decisions

- **`<Static>` for history**: Completed transcript items use Ink's `<Static>` for native scrollback
- **Dynamic area**: Streaming output, running tools, permission prompts, input
- **Custom input**: No `ink-text-input` – custom hook handles history, completions, multiline
- **Headless mode**: `--print` / `-p` flag for non-interactive usage with JSON output option

### Entry Points

- `src/index.ts`: Interactive TUI (`render` with `exitOnCtrlC: false`)
- `src/headless.ts`: Non-interactive streaming (text + NDJSON)

## Desktop Package (`@coded/desktop`)

### Architecture

```
src/
├── main/           # Electron main process
│   └── index.ts    # Window management, IPC handlers, agent lifecycle
├── preload/        # Preload script (context bridge)
│   └── index.ts    # Secure API exposure to renderer
└── renderer/       # React app (Vite)
    ├── index.tsx   # Entry point
    ├── App.tsx     # Main app component
    ├── api.ts      # Typed IPC wrapper
    └── components/ # UI components (Transcript, InputArea, Sidebar, Modals)
```

### IPC Communication

**Main → Renderer** (events):
- `agent:event:{id}` – Agent events (streaming, tool calls, permissions)

**Renderer → Main** (invokes):
- `app:load-config`, `app:get-recent-workspaces`, `app:pick-workspace`
- `app:encrypt`, `app:decrypt` (safeStorage)
- `agent:create`, `agent:run`, `agent:abort`, `agent:destroy`, `agent:get-messages`
- `agent:answer-permission`
- `fs:read`, `fs:write`, `fs:list`
- `shell:execute`

### Security

- **Context isolation**: Enabled
- **Sandbox**: Enabled
- **Preload only**: No Node.js APIs in renderer
- **safeStorage**: OS keychain for API keys (macOS Keychain, Windows DPAPI, Linux libsecret)

## Data Flow

### Chat Turn (CLI)

```
User Input
    │
    ▼
App.send() ──────────► Agent.run()
    │                      │
    │                      ▼
    │                 Provider.stream()
    │                      │
    │                      ▼
    │              AgentEvent stream
    │                      │
    ▼                      ▼
Transcript ◄────── App event handlers
    │
    ▼
Render
```

### Chat Turn (Desktop)

```
Renderer Input
    │
    ▼
api.agent.run()
    │
    ▼ (IPC)
Main: agent:run
    │
    ▼
DesktopAgent.run() ──────────► Agent.run()
    │                      │
    │                      ▼
    │                 Provider.stream()
    │                      │
    │                      ▼
    │              AgentEvent stream
    │                      │
    ▼                      ▼
Main: webContents.send() ──► Renderer: onEvent()
    │
    ▼
React state update
    │
    ▼
Render
```

## Build System

- **Monorepo**: pnpm workspaces
- **Core**: `tsc` → `dist/`
- **CLI**: `tsc` → `dist/` (entry: `dist/index.js`)
- **Desktop**: `electron-vite` (main, preload, renderer) → `out/`

## Testing

- **Core**: Vitest (unit tests for diff, paths, permissions, agent with scripted provider)
- **CLI**: Manual testing (TUI, headless)
- **Desktop**: Manual testing

## Deployment

### CLI

```bash
pnpm --filter @coded/cli build
# Binary at packages/cli/dist/index.js
```

### Desktop

```bash
pnpm --filter @coded/desktop build
# Packaged app at packages/desktop/dist-electron/
```

### Electron Builder Config

- **macOS**: DMG (x64 + arm64), notarization ready
- **Windows**: NSIS installer (x64 + ia32)
- **Linux**: AppImage (x64 + arm64)

## Extending

### Adding a Provider

1. Implement `Provider` interface in `packages/core/src/providers/`
2. Add to `ProviderRegistry.createProvider()`
3. Add to `DEFAULT_PROVIDERS` in `config.ts`
4. Add model entries to `MODEL_CATALOG` in `models.ts`

### Adding a Tool

1. Create tool definition in `packages/core/src/tools/`
2. Add to `createToolRegistry()` in `tools/index.ts`
3. Add permission category in `config.ts` defaults
4. Add UI handling in CLI/Desktop components

### Adding a Mode

1. Add to `BUILTIN_MODES` in `agent/modes.ts` or via config
2. Define: `id`, `name`, `description`, `prompt`, `tools`, `permissions`, `autoAllow`
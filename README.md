# Coded

An open-source, model-agnostic AI coding assistant for the terminal and desktop.

## Features

- **Terminal-first TUI** – Polished interactive interface built with Ink 8 + React 19
- **Cross-platform desktop app** – Electron + React with native feel on macOS, Windows, Linux
- **Model-agnostic** – Plug in your own API keys for OpenAI, Anthropic, Google, or local models (Ollama, LM Studio, etc.)
- **Two modes**:
  - **Build** – Full agent: reads, writes, and runs commands
  - **Plan** – Read-only analysis; asks before commands
- **File operations** – Read, write, edit, list, glob, grep
- **Command execution** – Run shell commands with approval
- **Session persistence** – Resume conversations across restarts
- **Permission system** – Allow once, always allow, or deny tool actions
- **Secure API key storage** – Electron safeStorage on desktop, 0600 file permissions on CLI

## Quick Start

### Prerequisites

- Node.js ≥ 20
- pnpm ≥ 9

### Installation

```bash
# Clone and install
git clone https://github.com/yourusername/coded.git
cd coded
pnpm install

# Build all packages
pnpm run build

# Run CLI
pnpm --filter @coded/cli start

# Run Desktop app
pnpm --filter @coded/desktop dev
```

### Configuration

1. Run `coded init` to create a project config at `.coded/config.json`
2. Run `coded` to start the TUI
3. Press `/keys` to add your API keys, or set environment variables:
   - `OPENAI_API_KEY`
   - `ANTHROPIC_API_KEY`
   - `GEMINI_API_KEY`
   - `OLLAMA_HOST` (for local models, default: `http://127.0.0.1:11434/v1`)

### Usage

```bash
# Interactive TUI
coded

# Start with a prompt
coded "add a test for the login function"

# Non-interactive (headless)
coded -p "explain the auth module" --json

# Pipe input
cat file.ts | coded -p "review this code"

# Use a specific model
coded -m anthropic/claude-sonnet-4-5

# Use plan mode (read-only)
coded --mode plan
```

## Project Structure

```
coded/
├── packages/
│   ├── core/          # Agent runtime, providers, tools, config, permissions
│   ├── cli/           # Terminal TUI (Ink + React)
│   └── desktop/       # Desktop app (Electron + React + Vite)
├── pnpm-workspace.yaml
└── package.json
```

## Commands

| Command | Description |
|---------|-------------|
| `coded` | Start interactive TUI |
| `coded "prompt"` | Start with initial prompt |
| `coded -p "prompt"` | Headless mode, print response |
| `coded init` | Write project config |
| `coded models` | List available models |
| `coded doctor` | Check configuration |

## TUI Keybindings

| Key | Action |
|-----|--------|
| `Enter` | Send message |
| `Shift+Enter` | New line |
| `↑/↓` | History navigation |
| `/` | Slash commands |
| `@` | File mentions |
| `Shift+Tab` | Switch mode |
| `Ctrl+C` | Stop / clear / exit |
| `Ctrl+L` | Clear screen |
| `Esc` | Close overlay |

### Slash Commands

| Command | Description |
|---------|-------------|
| `/help` | Show help |
| `/mode [build\|plan]` | Switch mode |
| `/model <provider/model>` | Switch model |
| `/keys` | Manage API keys |
| `/clear` | Clear conversation |
| `/compact` | Compact context |
| `/init` | Write AGENTS.md |
| `/sessions` | List sessions |
| `/resume [id]` | Resume session |
| `/usage` | Show token usage |
| `/exit` | Exit |

## Configuration

### Global Config (`~/.coded/config.json`)

```json
{
  "model": "anthropic/claude-sonnet-4-5",
  "providers": {
    "anthropic": {
      "apiKey": "env:ANTHROPIC_API_KEY",
      "baseURL": "env:ANTHROPIC_BASE_URL"
    },
    "openai": {
      "apiKey": "env:OPENAI_API_KEY",
      "baseURL": "env:OPENAI_BASE_URL"
    },
    "google": {
      "apiKey": "env:GEMINI_API_KEY",
      "baseURL": "env:GOOGLE_GENERATIVE_AI_BASE_URL"
    },
    "local": {
      "type": "openai",
      "apiKey": "local",
      "baseURL": "env:OLLAMA_HOST"
    }
  },
  "modes": {
    "custom": {
      "name": "Custom",
      "description": "Custom mode",
      "prompt": "Custom instructions...",
      "tools": ["read_file", "list_dir"],
      "permissions": {
        "read": "allow",
        "write": "ask",
        "shell": "ask",
        "network": "deny"
      }
    }
  },
  "permissions": {
    "allow": ["read_file", "list_dir"],
    "deny": ["rm -rf"]
  },
  "limits": {
    "maxSteps": 40,
    "maxOutputChars": 60000,
    "commandTimeoutMs": 120000,
    "contextTokens": 128000
  },
  "ui": {
    "theme": "dark",
    "showTokenUsage": true
  }
}
```

### Project Config (`.coded/config.json`)

Project-specific overrides for permissions, modes, and limits. Commit this to share with your team.

```json
{
  "$schema": "https://coded.dev/config.schema.json",
  "permissions": {
    "allow": ["read_file", "list_dir", "glob", "grep"],
    "deny": []
  },
  "limits": {
    "maxSteps": 40
  }
}
```

## Model Providers

| Provider | Type | Environment Variable | Default Base URL |
|----------|------|---------------------|------------------|
| OpenAI | openai | OPENAI_API_KEY | https://api.openai.com/v1 |
| Anthropic | anthropic | ANTHROPIC_API_KEY | https://api.anthropic.com |
| Google | google | GEMINI_API_KEY | https://generativelanguage.googleapis.com |
| Ollama | openai | OLLAMA_HOST | http://127.0.0.1:11434/v1 |
| OpenRouter | openai | OPENROUTER_API_KEY | https://openrouter.ai/api/v1 |
| Groq | openai | GROQ_API_KEY | https://api.groq.com/openai/v1 |

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed architecture documentation.

## Development

```bash
# Run tests
pnpm run test

# Typecheck all packages
pnpm run typecheck

# Format code
pnpm run format

# Lint
pnpm run lint

# Build all packages
pnpm run build

# CLI dev mode
pnpm --filter @coded/cli dev

# Desktop dev mode
pnpm --filter @coded/desktop dev
```

## License

MIT License - see [LICENSE](LICENSE) for details.
# cmr-memory

Persistent, cross-session memory for Claude Code agents.

## Overview

`cmr-memory` gives Claude Code agents a durable memory layer that
survives across sessions. It combines a CLI, Claude hooks, and a Skill
to retrieve and write notes without blocking agent work.

**Design principles:**
- All writes go through the agent (`cmr-memory write`).
- Reading is passive via a PreToolUse hook.
- The transcript is the intent signal for retrieval.
- Deduplication prevents context blowup.
- No extra processes or MCP servers; just an npm CLI.

## Authentication

`cmr-memory` requires an API key for memory calls. Provide it with
the `--api-key` flag or the `ANTHROPIC_API_KEY` environment variable.

```bash
npx cmr-memory init --api-key sk-ant-...
```

```bash
ANTHROPIC_API_KEY=sk-ant-... npx cmr-memory init
```

Configure or update the key later:

```bash
cmr-memory config --api-key sk-ant-...
```

Remove the key:

```bash
cmr-memory config --api-key off
```

## Installation

```bash
npx cmr-memory init --api-key sk-ant-...
```

Or use the environment variable:

```bash
ANTHROPIC_API_KEY=sk-ant-... npx cmr-memory init
```

### From source (cloned repo)

If you are running from a cloned repository, install dependencies first so the
`prepare` script builds `dist/`.

```bash
git clone https://github.com/agynio/claude-map-reduce-memory.git
cd claude-map-reduce-memory
npm install
npx cmr-memory init --api-key sk-ant-...
```

What `init` does:
- Installs the CLI globally (`cmr-memory`).
- Creates `~/.claude-memory/` with config/state/chunks.
- Registers PreToolUse + PostToolUse hooks in `~/.claude/settings.json`.
- Installs the Skill at `~/.claude/skills/memory/SKILL.md`.
- Prints a status summary (idempotent, merges existing hooks).

## Usage

### Agent-facing commands

These are called by the agent via the Bash tool.

```bash
cmr-memory write "note content" --when "activation condition"
```

```bash
cmr-memory retrieve "rate limiter config decisions" --max 5
```

```bash
cmr-memory list --limit 10
```

### User-facing commands

```bash
npx cmr-memory init --api-key sk-ant-...
npx cmr-memory status
npx cmr-memory config
npx cmr-memory config --api-key sk-ant-...
npx cmr-memory config --api-key off
npx cmr-memory config --max-hints 5
npx cmr-memory config --reminder on
npx cmr-memory config --reminder off
npx cmr-memory reset --confirm
npx cmr-memory uninstall
```

## How It Works

`cmr-memory` has four components:

1. **CLI**: The binary used for writing, listing, and retrieving notes.
2. **Skill**: Teaches the agent when to write or retrieve memory.
3. **PreToolUse hook**: Reads the transcript and upcoming tool call,
   runs scatter-gather retrieval across chunk files, and injects only
   NEW `[MEMORY]` hints via deduplication.
4. **PostToolUse hook**: Optional static reminder to consider writing
   memory after tool calls.

Retrieval uses a scatter-gather approach (one call per chunk), then
deduplicates against existing `[MEMORY]` hints in the transcript so
context size stays bounded as tool calls accumulate.

## Configuration

Config file: `~/.claude-memory/config.json`.

- **API key**: `cmr-memory config --api-key sk-ant-...`
- **Disable API key**: `cmr-memory config --api-key off`
- **Max hints**: `cmr-memory config --max-hints 5`
- **Reminder toggle**: `cmr-memory config --reminder on|off`

`--reminder off` removes the PostToolUse hook entry from
`~/.claude/settings.json`; `--reminder on` adds it back.

## Data Model

Data lives in `~/.claude-memory/`:

```
~/.claude-memory/
  config.json
  state.json
  chunks/
    chunk-001.json
    chunk-002.json
```

Notes are stored in chunk JSON files with content, activation `when`,
and timestamps. New notes append to the latest chunk until it reaches
the token limit, then a new chunk file is created.

## Error Handling

The hooks never block the agent. Errors return empty hook output and
log to stderr. CLI commands surface errors to the terminal and exit
non-zero so the agent can react.

## Uninstall

```bash
npx cmr-memory uninstall
```

This removes the hooks, the Skill, optionally deletes
`~/.claude-memory/`, and uninstalls the global CLI.

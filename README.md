# cmr-memory

Persistent, cross-session memory for Claude Code agents.

## Overview

Without persistent memory, a Claude Code agent resets to zero every session — repeating the same mistakes, ignoring learned preferences, requiring the same rules re-prompted every time. Claude's built-in `MEMORY.md` is per-repo and read once at startup; notes fall off by position as the file grows, not by relevance.

`cmr-memory` replaces that with context-activated retrieval. Notes are stored globally with a plain-language `--when` condition. Before every tool call, a PreToolUse hook reads the current transcript and runs retrieval against stored notes — using a small LLM that reasons about relevance rather than matching strings. Only hints that aren't already in the transcript are injected, so context stays bounded regardless of session length.

At scale, retrieval uses a map-reduce pattern: notes are split into fixed-size chunks and queried in parallel (one Haiku call per chunk) that makes it fast. Chunk system prompts are stable, so prompt caching keeps per-call cost low.

Everything ships as a single npm CLI. No extra processes, no MCP servers. `cmr-memory init` registers the hooks, injects instructions into `CLAUDE.md`, and configures the retrieval model in one command.


## Installation

```bash
npm install -g @agynio/cmr-memory
cmr-memory init --api-key sk-ant-...
```

## Authentication

`cmr-memory` requires an API key for memory calls. Provide it with
the `--api-key` flag or the `ANTHROPIC_API_KEY` environment variable.

```bash
cmr-memory init --api-key sk-ant-...
```

```bash
ANTHROPIC_API_KEY=sk-ant-... cmr-memory init
```

Configure or update the key later:

```bash
cmr-memory config --api-key sk-ant-...
```

Remove the key:

```bash
cmr-memory config --api-key off
```

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
cmr-memory init --api-key sk-ant-...
cmr-memory status
cmr-memory config
cmr-memory config --api-key sk-ant-...
cmr-memory config --api-key off
cmr-memory config --max-hints 5
cmr-memory config --reminder on
cmr-memory config --reminder off
cmr-memory reset --confirm
cmr-memory uninstall
```

## How It Works

`cmr-memory` has four components:

1. **CLI**: The binary used for writing, listing, and retrieving notes.
2. **CLAUDE.md guidance**: Teaches the agent when to write or retrieve memory.
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
cmr-memory uninstall
```

This removes the hooks, memory instructions from
`~/.claude/CLAUDE.md`, optionally deletes `~/.claude-memory/`, and
uninstalls the global CLI.

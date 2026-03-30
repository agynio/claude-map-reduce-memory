# cmr-memory

## Agent Memory Service for Claude Code — Specification v3.2

---

## 1. Overview

`cmr-memory` is an npm package that provides persistent, cross-session memory for Claude Code agents.

| Component | Role | Mechanism |
|-----------|------|-----------|
| **CLI** | Read/write memory notes | Agent calls via Bash tool |
| **Skill** | Teach agent how to use memory | ~/.claude/skills/memory/SKILL.md |
| **PreToolUse Hook** | Retrieve relevant memories | Returns additionalContext with dedup |
| **PostToolUse Hook** (optional) | Nudge agent to consider writing | Static string, configurable on/off |

### Design Principles

1. **All writes go through the agent**: Memory is only written when the agent runs `cmr-memory write`. The agent is always in control.
2. **Reading is passive**: PreToolUse hook silently injects relevant memories as additionalContext before each tool call.
3. **Transcript is the reasoning**: Hooks receive transcript_path with recent conversation — the agent's actual intent, not just tool I/O.
4. **Deduplication prevents context blowup**: additionalContext from hooks persists as `<system-reminder>` blocks in conversation history. The PreToolUse hook reads the transcript, extracts existing `<system-reminder>` blocks, and only injects NEW hints not already present. Once all relevant hints are in context, no new ones are added.
5. **No MCP, no extra processes**: The CLI is a plain npm binary. Default auth uses the local Claude Code session (no API key). Optional API key for separate billing.

### Key Constraint: additionalContext Persists

Claude Code's hook `additionalContext` is injected as a `<system-reminder>` block that **persists in conversation history**. It is NOT ephemeral. Each PreToolUse and PostToolUse additionalContext stays in context until compaction clears old tool results. This is a confirmed behavior (tested).

This means:
- PostToolUse nudge (~15 tokens) accumulates per tool call → acceptable, tiny
- PreToolUse memory hints (~120 tokens) would accumulate → solved by deduplication (section 5.7)

---

## 2. Authentication

The service supports two auth modes for its LLM calls (scatter-gather with Haiku):

### Default: Claude Code Session (No Configuration)

Uses the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`), which authenticates through the local Claude Code session automatically.

- Zero configuration
- No API key needed
- Uses subscription quota
- If Claude Code works, memory works

### Optional: Separate API Key

The user can configure a dedicated API key for memory calls. This keeps the main agent on subscription while memory uses pay-per-token billing separately.

```bash
cmr-memory config --api-key sk-ant-...
```

The key is stored in `~/.claude-memory/config.json` (not in shell environment). Claude Code never sees it — only the memory hooks read it. This means:
- Main agent continues using subscription
- Memory calls use the API key (billed per token)
- User controls cost separately

When an API key is configured, the service uses `@anthropic-ai/sdk` directly instead of the Agent SDK.

### Why Separate API Key?

- **Terms of service**: Anthropic may restrict subscription tokens in third-party tools. An API key is unambiguously permitted.
- **Quota management**: Heavy memory usage won't eat into the main agent's subscription quota.

---

## 3. Component 1: CLI

A globally installed npm binary that the agent calls via the Bash tool.

### 3.1 Agent-Facing Commands

Called by the agent during a session via Bash:

**cmr-memory write** — Write a note to memory.
```bash
cmr-memory write "note content here" --when "activation condition"
```
- First argument: the note content (required)
- --when: describes when this memory should activate (required). Include project name for project-specific notes. Omit project for universal knowledge.
- Behavior: Create Note, append to latest chunk file, start new chunk file if over limit
- Output (stdout): "Saved" (short confirmation)

**cmr-memory retrieve** — Search memory for relevant notes.
```bash
cmr-memory retrieve "rate limiter config decisions" --max 5
```
- First argument: search query (required)
- --max: maximum results (optional, default 5)
- Behavior: Run scatter-gather across all chunks with query as context. Returns ALL matches (no dedup — dedup only applies to passive PreToolUse retrieval).
- Output (stdout): Formatted list of matching notes with timestamps and content

**Dual mode**: This is the same command the PreToolUse hook calls. Detection:
- If a CLI argument is present → agent search mode (query from argument)
- If no argument and stdin has JSON → hook mode (context from transcript_path)

**cmr-memory list** — List recent notes.
```bash
cmr-memory list --limit 10
```
- --limit: number of notes (optional, default 10)
- Behavior: Read from recent chunks, newest first
- Output (stdout): Formatted list of recent notes

### 3.2 User-Facing Commands

Run by the user in their terminal:

```bash
npx cmr-memory init                    # setup everything
npx cmr-memory status                  # show memory stats
npx cmr-memory config                  # view current config
npx cmr-memory config --api-key sk-ant-...  # use separate API key
npx cmr-memory config --api-key off         # revert to subscription auth
npx cmr-memory config --max-hints 5         # change max hints
npx cmr-memory config --reminder off        # remove PostToolUse nudge hook
npx cmr-memory config --reminder on         # re-add PostToolUse nudge hook
npx cmr-memory reset --confirm              # clear all memory data
npx cmr-memory uninstall                    # remove hooks, skill, and data
```

Note: to temporarily disable all memory, run `cmr-memory uninstall`. To re-enable, run `cmr-memory init` (idempotent, won't reset data unless `reset` is called first).

---

## 4. Component 2: Skill

Teaches the agent when and how to use memory.

### 4.1 Installation Path

~/.claude/skills/memory/SKILL.md (user-level, all projects)

### 4.2 Skill Content

```
---
name: memory
description: Persistent memory across sessions. Memories auto-retrieved before tool calls. Use cmr-memory CLI to save important context.
---

# Memory

You have persistent memory that survives across sessions via the `cmr-memory` CLI.

## How It Works

- **Automatic retrieval**: Before each tool call, relevant memories
  appear as [MEMORY] blocks in your context. No action needed.
- **Reminders**: After tool calls, you may see a short reminder to
  consider saving noteworthy results. Use your judgment.
- **Explicit writes**: Run cmr-memory write when you make important
  decisions or discover something worth remembering.
- **Explicit search**: Run cmr-memory retrieve for specific past context.

## Writing Memory

Save important context:

  cmr-memory write "your note here" --when "activation condition"

The --when field is critical. It tells the memory system WHEN to surface
this note. Include:
- Project name for project-specific notes
- File paths, module names, or topics that should trigger recall
- Omit project name for universal knowledge (e.g. user preferences)

Examples:
  cmr-memory write "Auth expiry should be 900s not 3600s in config.ts" \
    --when "working on myapp, auth module, tokens, or editing config.ts"

  cmr-memory write "User prefers tabs over spaces" \
    --when "any project, code formatting, editor settings"

  cmr-memory write "Redis chosen for session storage over Postgres" \
    --when "working on dashboard project, session management, database decisions"

Write memory for:
- Decisions and rationale
- Discovered bugs and root causes
- Architecture facts and dependencies
- User preferences and project conventions
- Environment details and config values

Don't write memory for:
- Routine operations (file reads, standard test runs)
- Info already in code comments or docs
- Temporary debugging state

Good notes are specific:
- BAD: "Fixed the bug"
- GOOD: "Fixed auth token refresh in src/auth/token.ts — expiry was
  3600s, should be 900s per API spec"

Include: file paths, error messages, decision rationale, config values.

## Searching Memory

  cmr-memory retrieve "query here" --max 5

## Listing Recent Notes

  cmr-memory list
  cmr-memory list --limit 20
```

---

## 5. Component 3: PreToolUse Hook (Retrieval)

Passive retrieval. Fires before every tool call. Returns additionalContext with relevant memories. Uses deduplication to prevent context blowup.

### 5.1 Registration

In ~/.claude/settings.json:
```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "",
      "hooks": [{
        "type": "command",
        "command": "cmr-memory retrieve",
        "timeout": 15000
      }]
    }]
  }
}
```

Empty matcher = fires for all tools. The script skips cmr-memory commands internally.

### 5.2 Hook Input (stdin JSON)

```json
{
  "session_id": "abc123",
  "tool_name": "Bash",
  "tool_input": { "command": "npm test -- --grep auth" },
  "transcript_path": "/tmp/claude-transcript-abc123.jsonl"
}
```

### 5.3 Transcript as Intent Signal

transcript_path points to recent conversation turns. This tells the memory LLM WHY the agent is about to call a tool.

The transcript also contains all previous `<system-reminder>` blocks — which is critical for deduplication (section 5.7).

### 5.4 Skip Conditions

Return {} immediately (no LLM calls) if:
- tool_name is "Bash" AND tool_input.command contains "cmr-memory" (avoid recursion)
- No chunk files exist yet (fresh install)

### 5.5 Retrieval Flow

```
1. Parse hook input from stdin (no CLI argument → hook mode)
2. Check skip conditions → return {} if skip
3. Read transcript from transcript_path
4. Extract existing [MEMORY] hints from <system-reminder> blocks in transcript
5. Load all chunk files
6. If only one chunk → single call (with dedup)
7. If multiple chunks → scatter phase (parallel)
8. Reduce phase: deduplicate against existing hints
9. If all candidates already exist → return {} (nothing new)
10. If new hints found → return as additionalContext
```

### 5.6 Scatter Phase (Map)

Parallel, one call per chunk. Chunk notes in system prompt (stable, reusable). Tool context in user prompt.

System prompt (stable per chunk):
```
You are a memory retrieval agent. You hold one segment of memory notes.
Each note has content, an activation condition (when), and a timestamp.

<chunk_notes>
[2024-03-26] Auth expiry should be 900s not 3600s in config.ts
  → activate when: working on myapp, auth module, tokens, or editing config.ts

[2024-03-26] Redis chosen for session storage over Postgres
  → activate when: working on dashboard project, session management, database decisions

...
</chunk_notes>
```

User prompt (changes per tool call):
```
<transcript>
{last ~2000 tokens of conversation from transcript_path}
</transcript>

<upcoming_tool_call>
Tool: {tool_name}
Input: {tool_input, truncated}
</upcoming_tool_call>

Look at each note's "activate when" condition. If the condition matches
the transcript and upcoming tool call, extract the note's content as a
candidate hint. Up to 3 candidates, prefixed "- ". If nothing: NONE
```

Sealed chunks never change, so the same system prompt content is reused across calls. With API key mode, `cache_control: { type: "ephemeral" }` can be applied for input cost reduction.

### 5.7 Reduce Phase with Deduplication

This is the key mechanism that prevents context blowup.

Before merging candidates, extract what's already in context:

```typescript
function extractExistingHints(transcript: string): string[] {
  const reminderRegex = /<system-reminder>[\s\S]*?\[MEMORY\]([\s\S]*?)<\/system-reminder>/g
  const hints: string[] = []
  let match
  while ((match = reminderRegex.exec(transcript)) !== null) {
    hints.push(match[1].trim())
  }
  return hints
}
```

Then the reduce prompt includes existing hints:

```
<existing_memory_hints>
{extracted [MEMORY] hints already in agent's context}
</existing_memory_hints>

<candidates>
{numbered list of candidates from scatter phase}
</candidates>

<transcript>
{recent conversation}
</transcript>

Return ONLY hints that are NOT already present in existing_memory_hints.
Two hints are "the same" if they convey the same core fact, even if
worded differently.
If all candidates duplicate existing hints, return exactly: NONE
Otherwise return 1-3 new hints, one per line, prefixed "- ".
```

### 5.8 How Deduplication Prevents Blowup

Example session:

```
Tool call 1: agent runs npm test
  Existing reminders: (none)
  Candidates: "auth expiry is 900s not 3600s"
  Reduce: NEW → inject
  Context adds: +50 tokens

Tool call 2: agent reads config.ts
  Existing reminders: ["auth expiry is 900s not 3600s"]
  Candidates: "auth expiry 900s not 3600s", "config uses ms not seconds"
  Reduce: first is duplicate, second is NEW → inject only second
  Context adds: +50 tokens

Tool call 3: agent edits config.ts
  Existing reminders: ["auth expiry 900s", "config uses ms"]
  Candidates: "auth expiry 900s", "config uses ms"
  Reduce: ALL duplicates → NONE → return {}
  Context adds: 0 tokens

Tool calls 4-50: agent continues working on same topic
  Same candidates keep appearing → all duplicates → nothing injected
  Context adds: 0 tokens

Tool call 51: agent switches to new topic (deploy)
  Existing reminders: ["auth expiry 900s", "config uses ms"]
  Candidates: "prod deploy requires VPN", "deploy uses port 5433"
  Reduce: both NEW → inject
  Context adds: +100 tokens
```

**Bound on growth**: Context only grows when genuinely new hints appear. In a typical session working on 3-5 topics, each surfacing 2-3 unique hints = ~15 unique system-reminders total, regardless of tool call count.

```
Naive (no dedup):  200 tool calls × 120 tokens = 24,000 tokens
With dedup:        ~15 unique hints × 50 tokens = 750 tokens
```

### 5.9 Hook Output (stdout JSON)

When new memories found:
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "additionalContext": "[MEMORY] Auth token refresh should be 900s not 3600s in src/auth/config.ts\n[MEMORY] Config.ts rate limiter section uses milliseconds not seconds"
  }
}
```

When no new memories (all duplicates or nothing relevant):
```json
{}
```

### 5.10 Single Call Path (One Chunk)

When all notes fit in one chunk, scatter is skipped. The single call includes dedup directly:

```
System (stable):
  "You are a memory retrieval agent.
   Each note has content, an activation condition (when), and a timestamp.
   Notes: {all notes in activate-when format}"

User:
  "<existing_memory_hints>
   {any [MEMORY] hints already in context}
   </existing_memory_hints>

   <transcript>{conversation}</transcript>

   <upcoming_tool_call>Tool: {name}, Input: {input}</upcoming_tool_call>

   Look at each note's activation condition. Return 1-3 hints matching
   the transcript that are NOT already in existing_memory_hints.
   If nothing new: NONE"
```

---

## 6. Component 4: PostToolUse Hook (Memory Reminder) — Optional

A static reminder appended to every tool result, nudging the agent to consider saving noteworthy results to memory. No LLM call — just a short static string. Configurable: user can turn it on or off.

When disabled, the Skill alone teaches the agent when to write memory.

### 6.1 Registration

Registered by default during `init`. User can remove with `cmr-memory config --reminder off`.

```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "",
      "hooks": [{
        "type": "command",
        "command": "cmr-memory remind"
      }]
    }]
  }
}
```

### 6.2 What the Hook Does

```bash
#!/bin/bash
# cmr-memory remind

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name')
TOOL_CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Skip if this is a cmr-memory command (avoid recursion)
if [ "$TOOL_NAME" = "Bash" ] && echo "$TOOL_CMD" | grep -q "cmr-memory"; then
  exit 0
fi

# Return static nudge
cat << 'HOOKEOF'
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "If noteworthy: cmr-memory write \"note\" --when \"condition\""
  }
}
HOOKEOF
exit 0
```

No LLM call. No analysis. No cost. Instant.

### 6.3 Context Impact

The nudge is ~15 tokens. It persists as a `<system-reminder>` on each tool result.

```
50 tool calls  × 15 tokens = 750 tokens   (~0.3% of 200k context)
200 tool calls × 15 tokens = 3000 tokens  (~1.5% of 200k context)
```

Negligible. Old tool results + their system-reminders are cleaned up during compaction.

### 6.4 Configuration

```bash
# Disable the reminder
cmr-memory config --reminder off
# → removes PostToolUse hook entry from ~/.claude/settings.json

# Re-enable
cmr-memory config --reminder on
# → adds PostToolUse hook entry back to ~/.claude/settings.json
```

No config flag stored — the hook's presence in settings.json IS the config.

---

## 7. Data Model

### 7.1 Note

```typescript
// What the LLM sees in scatter prompts
interface NoteLLM {
  content: string       // the memory
  when: string          // activation condition
  timestamp: number     // for display and recency
}

// Full note on disk (includes internal meta)
interface Note {
  content: string
  when: string
  timestamp: number
  id: string            // uuid, internal tracking only
  tokens: number        // for chunk size accounting only
}
```

### 7.2 Chunk Files

Chunks are plain JSON files in `~/.claude-memory/chunks/`, named by sequence number:

```
chunk-001.json
chunk-002.json
chunk-003.json  ← latest, may still grow
```

Each file:
```json
{
  "notes": [ ... ],
  "meta": {
    "totalTokens": 18500
  }
}
```

The latest file (highest sequence number) may still receive new notes. All others are full and will not change.

No `sealed`, `active`, `sealedAt`, or `createdAt` fields needed — the sequence number and position determine everything.

### 7.3 Chunk Lifecycle

Write always goes to the latest chunk file.

**Write path** (`cmr-memory write`):
```
1. Create Note object (id, timestamp, content, when, tokens)
2. Read latest chunk file (highest sequence number)
3. Append note to its notes array
4. Update meta.totalTokens
5. If totalTokens >= CHUNK_TOKEN_LIMIT (20,000):
   → write current file
   → create next file (chunk-{N+1}.json) with empty notes
6. Update state.json
```

**Why 20,000 tokens per chunk?**
- ~50 notes per chunk (average note ~400 tokens)
- Each chunk fits comfortably as a system prompt for a Haiku call
- Scatter-gather runs one call per chunk in parallel
- Small enough that adding a new chunk doesn't meaningfully increase latency

**Example timeline**:
```
Session 1:  30 notes → chunk-001.json (12k tokens, still growing)
Session 2:  25 more  → chunk-001.json fills at 20k, chunk-002.json starts
Session 3:  40 more  → chunk-002.json fills, chunk-003.json starts
...
Month 6:    ~1000 notes → 20 chunk files
```

### 7.4 State

```typescript
interface State {
  nextChunkSequence: number  // next file will be chunk-{this}.json
  totalNotes: number
}
```

### 7.5 Config

```typescript
interface Config {
  chunkTokenLimit: number   // default: 20000
  maxHints: number          // default: 3
  model: string             // default: "claude-haiku-4-5-20251001"
  apiKey: string | null     // default: null — if set, use raw SDK instead of Agent SDK
}
```

---

## 8. Filesystem Layout

```
~/.claude-memory/
  config.json
  state.json
  chunks/
    chunk-001.json
    chunk-002.json
    chunk-003.json    ← latest, may still grow
```

---

## 9. Caching & Optimization Strategy

Chunk files that are full will never change. This is important for two reasons:
1. The same content is sent in every scatter call — no wasted computation on changing data.
2. When dedup (section 5.7) determines all relevant hints are already in context, the reduce call is skipped entirely.

In practice, after the first few tool calls on a topic, most subsequent scatter-gathers return quickly or produce no new hints — making the system efficient regardless of auth mode.

### Cost per tool call

**Default (subscription):** $0 additional cost. Memory calls consume subscription quota. Haiku is lightweight — a fraction of what the main Sonnet/Opus agent consumes per tool call.

**With API key configured:** Pay-per-token. See Anthropic's pricing page for current Haiku rates. With 10 chunks and ~200 tokens output, expect roughly $0.01 per tool call.

PostToolUse: $0 in both modes (static string, no LLM call).

### Subscription Quota Impact

Each scatter-gather uses Haiku calls. Haiku is significantly cheaper in quota terms than Sonnet/Opus. Rough estimates:
- Per tool call: equivalent to ~1 small Haiku message
- Per 100 tool calls: equivalent to ~100 small Haiku messages
- This is a fraction of what the main agent (Sonnet/Opus) consumes per tool call

When dedup returns NONE (all hints already in context), the reduce call is skipped. In practice, after the first few tool calls on a topic, most subsequent calls either return quickly or skip entirely.

---

## 10. Installation

### 10.1 One Command Install

Prerequisites: Claude Code installed and authenticated (`claude /login` completed).

```bash
npx cmr-memory init
```

That's it. No API key to configure.

### 10.2 What init Does

**Step 1: Install CLI globally**
```bash
npm install -g cmr-memory
```
Makes `cmr-memory` available as a command for the agent to call via Bash.

**Step 2: Create data directory**
```
~/.claude-memory/
  config.json
  state.json
  chunks/
```

**Step 3: Register hooks**

Merges into ~/.claude/settings.json:
```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "",
      "hooks": [{
        "type": "command",
        "command": "cmr-memory retrieve",
        "timeout": 15000
      }]
    }],
    "PostToolUse": [{
      "matcher": "",
      "hooks": [{
        "type": "command",
        "command": "cmr-memory remind"
      }]
    }]
  }
}
```

PostToolUse hook is registered by default. User can remove it later with `cmr-memory config --reminder off`.
If ~/.claude/settings.json exists with other hooks, init merges without overwriting.

**Step 4: Install skill**

Writes to: ~/.claude/skills/memory/SKILL.md

**Step 5: Validate and print status**

```
cmr-memory v1.0.0

  ✓ CLI installed globally
  ✓ Data directory: ~/.claude-memory/
  ✓ PreToolUse hook registered
  ✓ PostToolUse hook registered (reminder: on)
  ✓ Skill installed: ~/.claude/skills/memory/SKILL.md
  ✓ Auth: Claude Code session (default)

Ready. Start a Claude Code session to begin building memory.

Tip: To use a separate API key for memory calls:
  cmr-memory config --api-key sk-ant-...
```

Idempotent: running again skips existing config.

### 10.3 Verification

```bash
# Verify CLI is available
cmr-memory status

# Inside Claude Code session
> /hooks
# Should show PreToolUse and PostToolUse entries for cmr-memory

# Test the agent can call it
> Run: cmr-memory list
```

### 10.4 Uninstall

```bash
npx cmr-memory uninstall
```

1. Removes hooks from ~/.claude/settings.json
2. Removes skill from ~/.claude/skills/memory/
3. Asks whether to remove data (~/.claude-memory/)
4. Uninstalls global CLI: npm uninstall -g cmr-memory

---

## 11. User Flow

### 11.1 First Session

User starts Claude Code normally:

```bash
claude
```

Nothing changes about how they work. Memory builds invisibly.

What happens on each tool call:

1. Agent is about to call a tool (e.g. Bash: npm test)
2. PreToolUse hook fires → no chunks yet → returns {} (empty)
3. Tool executes, agent sees result
4. PostToolUse hook fires → returns static nudge
5. Agent sees result + "If noteworthy: cmr-memory write..."
6. Agent decides whether to write based on Skill training

What the user sees:

```
You: Fix the failing auth tests

Claude: Let me check the test output.
  > Bash: npm test -- --grep "auth"

  3 tests failing in token.test.ts lines 23, 45, 67.

  If noteworthy: cmr-memory write "note" --when "condition"

  These failures are important — let me save this finding.

  > Bash: cmr-memory write "Auth test suite: 3 failures in
    token.test.ts lines 23,45,67 — token refresh related"
    --when "working on myapp, auth tests, token.test.ts"

  Saved. Let me look at the source.

  > Bash: cat src/auth/token.ts

  Found it — refresh token expiry is 3600s but should be 900s.

  If noteworthy: cmr-memory write "note" --when "condition"

  > Bash: cmr-memory write "Auth token refresh: expiry should be
    900s not 3600s. Constant AUTH_TOKEN_EXPIRY in src/auth/config.ts"
    --when "working on myapp, auth, tokens, or editing config.ts"

  Saved. Now fixing...
```

### 11.2 Same Session, Later (Dedup in Action)

After the agent has written a few notes and PreToolUse starts surfacing them:

```
You: Now check the rate limiter config

Claude:
  > Bash: cat src/config.ts

  [MEMORY] Auth token expiry should be 900s not 3600s in config.ts

  I see the rate limiter section. My memory reminds me about the
  auth token fix in this same file — I'll be careful not to break it.

  > Bash: cat src/rate-limiter.ts

  (PreToolUse runs: "auth expiry 900s" already in context → NONE → no new hints)
  (No new [MEMORY] injected — dedup prevented duplicate)

  The rate limiter looks fine. Let me update the threshold...
```

### 11.3 New Session (Next Day)

Memory persists across sessions:

```
You: The auth tests are broken again

Claude:
  > Bash: npm test -- --grep "auth"

  [MEMORY] Auth token refresh: expiry should be 900s not 3600s.
  Constant AUTH_TOKEN_EXPIRY in src/auth/config.ts.

  I remember this issue. AUTH_TOKEN_EXPIRY in src/auth/config.ts
  should be 900, not 3600. Let me check if it was reverted...

  > Bash: grep AUTH_TOKEN_EXPIRY src/auth/config.ts

  (PreToolUse: "auth expiry 900s" already in context → no new hint)

  Yes — reverted to 3600. Same issue as before. Fixing and adding
  a comment this time.
```

### 11.4 Agent Writes Proactively

The Skill teaches the agent to save decisions without a nudge:

```
You: Use Redis for session storage instead of Postgres

Claude: Good call. Let me record this decision first.

  > Bash: cmr-memory write "User decision: use Redis for session
    storage instead of Postgres. Reason: performance for
    high-concurrency session lookups."
    --when "working on myapp, session management, database decisions"

  Saved. Now implementing...
```

### 11.5 Agent Retrieves Memory

```
You: What did we decide about API versioning?

Claude: Let me check my memory.

  > Bash: cmr-memory retrieve "API versioning decisions"

  [2024-03-15] All API routes follow /api/v2/{resource} convention.
  Legacy v1 routes deprecated but still active.

  [2024-03-18] API versioning uses URL path, not headers.
  Decision made with team.

  Based on my memory: we use URL-based versioning with
  /api/v2/{resource}. Legacy v1 routes are still active...
```

### 11.6 Memory Management

```bash
npx cmr-memory status

  Memory Status:
    Notes:      47
    Chunks:     3 (chunk-001, chunk-002, chunk-003)
    Latest:     chunk-003 (12 notes, ~3.2k tokens)
    Storage:    48 KB
    Reminder:   on
    Auth:       Claude Code session (subscription)
    # OR:
    Auth:       API key (sk-ant-...xxxx)

npx cmr-memory list
npx cmr-memory reset --confirm
npx cmr-memory config --reminder off
npx cmr-memory uninstall
```

### 11.7 Scaling Over Time

Week 1 (few notes):
- 1 chunk, single LLM call per retrieval
- Zero additional cost (subscription)
- Instant hints

Month 1 (~200 notes):
- 4-5 chunks, parallel scatter-gather
- Minimal quota impact (Haiku calls)
- Hints in 1-2 seconds
- Dedup keeps context growth flat

Month 6 (~1000 notes):
- 20 chunks, parallel scatter-gather
- Moderate quota impact (still Haiku)
- Hints in 2-3 seconds
- ~15-30 unique system-reminders in context (not 200×)

---

## 12. Error Handling

Principle: NEVER block the agent. All errors → empty output, log to stderr.

| Error | Behavior |
|-------|----------|
| No auth credentials | Log error, return {} (Claude Code session may have expired) |
| API rate limit | Log warning, return {} |
| One chunk scatter fails | Use remaining chunk results |
| All scatter calls fail | Return {} |
| Reduce call fails | Return unmerged top-3 candidates |
| Stdin parse error | Return {} |
| Filesystem error | Return {} |
| transcript_path missing | Proceed without dedup (treat as no existing hints) |
| transcript_path unreadable | Proceed without dedup |
| PostToolUse hook fails | No nudge shown, agent continues |

Hooks always exit 0. Errors go to stderr only.

CLI write/retrieve/list commands: errors print to stderr, exit non-zero. The agent sees the error in Bash output and can handle it.

---

## 13. Constants

```
CHUNK_TOKEN_LIMIT      = 20000     (~50 notes per chunk)
MAX_HINTS              = 3
DEFAULT_MODEL          = "claude-haiku-4-5-20251001"
PRE_HOOK_TIMEOUT       = 15000ms
SCATTER_TIMEOUT        = 12000ms
MERGE_TIMEOUT          = 5000ms
MAX_TRANSCRIPT_TOKENS  = 2000
MAX_TOOL_INPUT_CHARS   = 500
TOKEN_ESTIMATE_DIVISOR = 4       (chars per token approx)
MEMORY_REMINDER_TEXT   = "If noteworthy: cmr-memory write \"note\" --when \"condition\""
```

---

## 14. Package Structure

```
cmr-memory/
  package.json
  tsconfig.json

  src/
    cli.ts                CLI entry point (write, retrieve, list, init, status, etc.)
    retrieve.ts           PreToolUse hook + agent search: scatter-gather → dedup → output
    remind.ts             PostToolUse hook: static nudge (no LLM call)
    store.ts              Chunk/note filesystem operations
    scatter-gather.ts     Parallel hint extraction (Agent SDK or raw SDK based on config)
    dedup.ts              Extract existing hints from transcript, deduplicate
    format.ts             Prompt formatting and response parsing
    tokens.ts             Token counting utility

  bin/
    cmr-memory         Executable entry point
```

Dependencies:
- @anthropic-ai/claude-agent-sdk (default auth via subscription)
- @anthropic-ai/sdk (optional, used when apiKey configured)
- uuid

---

## 15. Data Flow

### Write Path (single source)

```
Agent runs: Bash: cmr-memory write "note" --when "condition"
  → cli.ts parses args
  → store.appendNote(note)
  → store.startNewChunkIfFull()
  → stdout: "Saved"
  → agent sees confirmation in Bash output

Triggered by:
  a. Agent's own initiative (taught by Skill)
  b. Agent responding to PostToolUse reminder nudge
  c. Both go through the same CLI command
```

### Read Paths (two modes)

```
Path A: Passive retrieval (every tool call, deduped)
  PreToolUse hook fires
  → no CLI arg, stdin has JSON → hook mode
  → read transcript
  → extract existing [MEMORY] hints from <system-reminder> blocks
  → scatter-gather across chunks
  → reduce: only return hints NOT already in context
  → if new hints: return hookSpecificOutput.additionalContext
  → if all duplicates: return {} (nothing added)

Path B: Explicit retrieval (agent-initiated)
  Agent runs: Bash: cmr-memory retrieve "query"
  → CLI arg present → agent search mode
  → scatter-gather with query as context
  → return ALL matches (no dedup)
  → formatted results to stdout
```

### Full Tool Call Lifecycle

```
1. Agent decides to call a tool
2. PreToolUse hook fires (sync)
   a. Skip if tool is cmr-memory command
   b. Read transcript_path
   c. Extract existing [MEMORY] system-reminders from transcript
   d. Scatter across chunks (parallel)
   e. Reduce: filter out candidates already in context
   f. If new hints: return additionalContext with [MEMORY] prefix
   g. If all duplicates: return {} (no new system-reminder added)
3. Agent sees [MEMORY] hints (if any new), proceeds with tool call
4. Tool executes, returns output
5. PostToolUse hook fires (if registered)
   a. Skip if tool is cmr-memory command
   b. Return static nudge (~15 tokens)
6. Agent sees tool output + nudge
7. Agent decides whether to run cmr-memory write
8. Next tool call: go to step 1
```

---

## 16. Future Considerations (NOT in v1)

1. Chunk pre-filtering: store one-line summary per chunk when full. Skip irrelevant chunks before scatter. Saves cost at high chunk counts.
2. Note deduplication: detect near-duplicate notes in storage, keep latest.
3. Selective hook triggering: configurable which tools trigger PreToolUse retrieval.
4. Multi-project isolation: scope memory per project directory instead of global.
5. Memory decay: notes that never surface in hints could be pruned over time.
6. Export/import: dump memory as markdown for human review.
7. Embedding pre-filter: cheap embeddings to pre-filter chunks before LLM scatter.
8. Smart reminder: replace static PostToolUse nudge with LLM-based analysis (was in earlier spec versions, deferred for cost/complexity).

---

## 17. Success Criteria

1. `npx cmr-memory init` sets up everything in one command — no API key needed
2. Agent can write/retrieve/list memory via Bash commands
3. PreToolUse hook returns relevant memories as additionalContext
4. Deduplication prevents context blowup — unique hints only
5. PostToolUse reminder is configurable on/off
6. Skill teaches the agent to use memory effectively
7. Parallel scatter-gather works with 2+ chunks
8. No tool call is ever blocked — errors degrade to no hints
9. PreToolUse hook latency under 5s for ≤20 chunks
10. No MCP server, no extra processes, no API key — just a CLI and hooks
11. Works with any Claude Code subscription out of the box

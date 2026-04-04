import fs from 'node:fs/promises'

import { getFlagValue, getPositionalArgs, parsePositiveInt } from './args'
import { MAX_TRANSCRIPT_TOKENS } from './constants'
import { extractExistingHints } from './dedup'
import { isRecord } from './guards'
import { isClaudeMemoryCommand } from './hooks'
import { gatherHookHints, gatherQueryResults } from './scatter-gather'
import { loadChunks, loadConfig } from './store'
import { parseTranscriptJSONL } from './transcript'
import { truncateToTokenLimit } from './tokens'
import type { HookInput, RawHookInput } from './types'

function parseHookInput(raw: string): HookInput {
  const parsed = JSON.parse(raw) as RawHookInput
  if (!isRecord(parsed)) {
    throw new Error('Invalid hook input')
  }
  const toolName =
    typeof parsed.tool_name === 'string' && parsed.tool_name.trim().length > 0
      ? parsed.tool_name
      : null
  if (!toolName) {
    throw new Error('Missing tool_name')
  }
  const toolInput = isRecord(parsed.tool_input) ? parsed.tool_input : {}
  const transcriptPath =
    typeof parsed.transcript_path === 'string' ? parsed.transcript_path : undefined

  return {
    tool_name: toolName,
    tool_input: toolInput,
    transcript_path: transcriptPath
  }
}

async function readTranscript(transcriptPath?: string): Promise<string> {
  if (!transcriptPath) {
    return ''
  }
  try {
    return await fs.readFile(transcriptPath, 'utf8')
  } catch {
    return ''
  }
}

function formatHookOutput(hints: string[]): string {
  const additionalContext = hints.map((hint) => `[MEMORY] ${hint}`).join('\n')
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext
    }
  })
}

export type RetrieveMode =
  | { mode: 'query'; query: string; maxResults: number }
  | { mode: 'hook' }
  | { mode: 'error'; message: string }

export function resolveRetrieveMode(
  args: string[],
  stdinIsTTY: boolean
): RetrieveMode {
  const positional = getPositionalArgs(args)
  const query = positional[0]
  const maxResults = parsePositiveInt(getFlagValue(args, '--max'), 5)

  if (query) {
    return { mode: 'query', query, maxResults }
  }
  if (!stdinIsTTY) {
    return { mode: 'hook' }
  }
  return {
    mode: 'error',
    message: 'retrieve requires a query or piped stdin JSON'
  }
}

export async function runRetrieveHook(rawInput: string): Promise<string> {
  try {
    const hookInput = parseHookInput(rawInput)
    if (isClaudeMemoryCommand(hookInput.tool_name, hookInput.tool_input)) {
      return '{}'
    }

    const config = await loadConfig()
    if (!config.apiKey) {
      console.error('API key not configured')
      return '{}'
    }
    const chunks = await loadChunks()
    if (chunks.length === 0) {
      return '{}'
    }

    const transcript = await readTranscript(hookInput.transcript_path)
    const structuredTranscript = parseTranscriptJSONL(
      transcript,
      config.lastReasoningPairs
    )
    const trimmedTranscript = truncateToTokenLimit(
      structuredTranscript,
      MAX_TRANSCRIPT_TOKENS
    )
    const existingHints = transcript ? extractExistingHints(transcript) : []
    const toolInputText = JSON.stringify(hookInput.tool_input)

    const hints = await gatherHookHints({
      config,
      chunks,
      transcript: trimmedTranscript,
      toolName: hookInput.tool_name,
      toolInput: toolInputText,
      existingHints
    })

    if (hints.length === 0) {
      return '{}'
    }

    return formatHookOutput(hints)
  } catch (error) {
    console.error(`Retrieve hook error: ${error}`)
    return '{}'
  }
}

function parseDateFromLine(line: string): number {
  const match = /^\[(\d{4}-\d{2}-\d{2})\]/.exec(line)
  if (!match) {
    return 0
  }
  const dateValue = Date.parse(match[1])
  return Number.isNaN(dateValue) ? 0 : dateValue
}

export async function runRetrieveQuery(
  query: string,
  maxResults: number
): Promise<string> {
  const config = await loadConfig()
  if (!config.apiKey) {
    throw new Error('API key not configured. Run cmr-memory config --api-key')
  }
  const chunks = await loadChunks()
  if (chunks.length === 0) {
    return 'No notes yet.'
  }

  const results = await gatherQueryResults({
    config,
    chunks,
    query,
    maxResults
  })

  if (results.length === 0) {
    return 'No matches.'
  }

  const ordered = [...results].sort(
    (a, b) => parseDateFromLine(b) - parseDateFromLine(a)
  )
  return ordered.slice(0, maxResults).join('\n')
}

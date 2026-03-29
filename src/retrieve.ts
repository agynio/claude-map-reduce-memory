import fs from 'node:fs/promises'

import { MAX_TRANSCRIPT_TOKENS } from './constants'
import { extractExistingHints } from './dedup'
import { gatherHookHints, gatherQueryResults } from './scatter-gather'
import { loadChunks, loadConfig } from './store'
import { truncateToTokenLimit } from './tokens'
import type { HookInput } from './types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseHookInput(raw: string): HookInput {
  const parsed = JSON.parse(raw) as unknown
  if (!isRecord(parsed)) {
    throw new Error('Invalid hook input')
  }
  const toolName = typeof parsed.tool_name === 'string' ? parsed.tool_name : null
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

function shouldSkipHook(toolName: string, toolInput: Record<string, unknown>): boolean {
  if (toolName !== 'Bash') {
    return false
  }
  const command =
    typeof toolInput.command === 'string' ? toolInput.command : ''
  return command.includes('claude-memory')
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

export async function runRetrieveHook(rawInput: string): Promise<string> {
  try {
    const hookInput = parseHookInput(rawInput)
    if (!hookInput.tool_name || !hookInput.tool_input) {
      return '{}'
    }
    if (shouldSkipHook(hookInput.tool_name, hookInput.tool_input)) {
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
    const trimmedTranscript = truncateToTokenLimit(
      transcript,
      MAX_TRANSCRIPT_TOKENS
    )
    const existingHints = transcript
      ? extractExistingHints(transcript)
      : []
    const toolInputText = JSON.stringify(hookInput.tool_input ?? {})

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
    throw new Error('API key not configured. Run claude-memory config --api-key')
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

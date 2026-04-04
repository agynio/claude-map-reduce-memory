import assert from 'node:assert/strict'

import { isRecord } from './guards'

type ToolCall = {
  name: string
  input: string
}

type AssistantEntry = {
  kind: 'assistant'
  text: string
  toolCalls: ReadonlyArray<ToolCall>
  lineIndex: number
}

type HumanEntry = {
  kind: 'human'
  text: string
  lineIndex: number
}

type ParsedEntry = AssistantEntry | HumanEntry

type ParsedTranscript = {
  assistants: AssistantEntry[]
  allEntries: ParsedEntry[]
}

type TranscriptSection = {
  index: number
  text: string
}

const EMPTY_TOOL_CALLS: ReadonlyArray<ToolCall> = Object.freeze([])
const EMPTY_ASSISTANT: Readonly<{ text: string; toolCalls: ReadonlyArray<ToolCall> }> =
  Object.freeze({
    text: '',
    toolCalls: EMPTY_TOOL_CALLS
  })

function normalizeText(parts: string[]): string {
  return parts
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join('\n')
}

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') {
    return content.trim()
  }
  if (!Array.isArray(content)) {
    return ''
  }
  const parts = content.flatMap((block) => {
    if (!isRecord(block)) {
      return []
    }
    if (block.type === 'text' && typeof block.text === 'string') {
      return [block.text]
    }
    return []
  })
  return normalizeText(parts)
}

function stringifyToolInput(input: unknown): string {
  if (input === undefined) {
    return ''
  }
  if (typeof input === 'string') {
    return input
  }
  const serialized = JSON.stringify(input)
  assert(serialized !== undefined, 'Unsupported tool input')
  return serialized
}

function extractAssistantMessage(message: unknown): {
  text: string
  toolCalls: ReadonlyArray<ToolCall>
} {
  if (!isRecord(message)) {
    return EMPTY_ASSISTANT
  }
  const content = message.content
  if (typeof content === 'string') {
    return { text: content.trim(), toolCalls: [] }
  }
  if (!Array.isArray(content)) {
    return EMPTY_ASSISTANT
  }

  const textParts: string[] = []
  const toolCalls: ToolCall[] = []
  for (const block of content) {
    if (!isRecord(block)) {
      continue
    }
    if (block.type === 'text' && typeof block.text === 'string') {
      textParts.push(block.text)
      continue
    }
    if (block.type === 'tool_use') {
      const name = typeof block.name === 'string' ? block.name.trim() : ''
      if (!name) {
        continue
      }
      const input = stringifyToolInput(block.input)
      toolCalls.push({ name, input })
    }
  }

  return {
    text: normalizeText(textParts),
    toolCalls
  }
}

function parseTranscript(raw: string): ParsedTranscript {
  const assistants: AssistantEntry[] = []
  const allEntries: ParsedEntry[] = []
  const lines = raw.split(/\r?\n/)

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex].trim()
    if (line === '') {
      continue
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(line) as unknown
    } catch {
      continue
    }
    if (!isRecord(parsed) || typeof parsed.type !== 'string') {
      continue
    }
    if (parsed.type === 'human') {
      const message = isRecord(parsed.message) ? parsed.message : undefined
      const text = message ? extractTextContent(message.content) : ''
      if (!text) {
        continue
      }
      const entry: HumanEntry = { kind: 'human', text, lineIndex }
      allEntries.push(entry)
      continue
    }

    if (parsed.type === 'assistant') {
      const message = isRecord(parsed.message) ? parsed.message : undefined
      const { text, toolCalls } = message
        ? extractAssistantMessage(message)
        : EMPTY_ASSISTANT
      if (!text && toolCalls.length === 0) {
        continue
      }
      const entry: AssistantEntry = {
        kind: 'assistant',
        text,
        toolCalls,
        lineIndex
      }
      assistants.push(entry)
      allEntries.push(entry)
    }
  }

  return {
    assistants,
    allEntries
  }
}

function formatToolCall(call: ToolCall): string {
  if (!call.input) {
    return `Tool: ${call.name}`
  }
  return `Tool: ${call.name} Input: ${call.input}`
}

function formatReasoningPair(entry: AssistantEntry): string {
  const lines = [`Reasoning: ${entry.text}`]
  if (entry.toolCalls.length > 0) {
    lines.push('Tool calls:')
    lines.push(...entry.toolCalls.map((call) => `  - ${formatToolCall(call)}`))
  }
  return lines.join('\n')
}

function assertValidReasoningPairs(value: number): number {
  assert(
    Number.isFinite(value) && value >= 1,
    `Invalid lastReasoningPairs: ${value}`
  )
  return Math.floor(value)
}

export function parseTranscriptJSONL(
  raw: string,
  lastReasoningPairs: number
): string {
  if (raw.trim().length === 0) {
    return ''
  }
  const parsed = parseTranscript(raw)
  const sectionEntries: TranscriptSection[] = []
  const reasoningLimit = assertValidReasoningPairs(lastReasoningPairs)

  let excludedAssistantIndex: number | null = null
  for (
    let entryIndex = parsed.allEntries.length - 1;
    entryIndex >= 0;
    entryIndex -= 1
  ) {
    const entry = parsed.allEntries[entryIndex]
    if (entry.kind === 'human') {
      const previous = parsed.allEntries[entryIndex - 1]
      if (previous?.kind === 'assistant' && previous.text) {
        sectionEntries.push({
          index: previous.lineIndex,
          text: `Assistant: ${previous.text}\nUser: ${entry.text}`
        })
        excludedAssistantIndex = previous.lineIndex
      } else {
        sectionEntries.push({
          index: entry.lineIndex,
          text: `User: ${entry.text}`
        })
      }
      break
    }
  }

  const assistantEntries = parsed.assistants.filter(
    (entry) => entry.text && entry.lineIndex !== excludedAssistantIndex
  )

  if (assistantEntries.length > 0) {
    const latestAssistant = assistantEntries[assistantEntries.length - 1]
    const previousCandidates = assistantEntries.slice(0, -1)
    const previousPairs = previousCandidates.slice(
      Math.max(previousCandidates.length - (reasoningLimit - 1), 0)
    )

    for (const entry of previousPairs) {
      sectionEntries.push({
        index: entry.lineIndex,
        text: formatReasoningPair(entry)
      })
    }

    if (latestAssistant.text) {
      sectionEntries.push({
        index: latestAssistant.lineIndex,
        text: `Reasoning: ${latestAssistant.text}`
      })
    }
  }

  if (sectionEntries.length === 0) {
    return ''
  }

  return sectionEntries
    .sort((a, b) => a.index - b.index)
    .map((section) => section.text)
    .join('\n\n')
}

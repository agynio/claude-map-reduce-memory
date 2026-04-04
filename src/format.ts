import { MAX_TOOL_INPUT_CHARS } from './constants'
import type { Note } from './types'

const BULLET_LIST_FORMAT_INSTRUCTIONS = [
  'Respond ONLY with a plain dash-prefixed list. No numbers, no bold, no extra text.',
  'Format exactly:',
  '- first hint',
  '- second hint',
  'If nothing matches: NONE'
]

const QUERY_BULLET_LIST_FORMAT_INSTRUCTIONS = [
  'Respond ONLY with a plain dash-prefixed list. No numbers, no bold, no extra text.',
  'Format exactly:',
  '- [2026-03-30] first hint',
  '- [2026-03-31] second hint',
  'If nothing matches: NONE'
]

const BULLET_LINE_PATTERN = /^[-*]\s+(.*)$/
const NUMBERED_LINE_PATTERN = /^\d+\.\s+(.*)$/
const DATE_LINE_PATTERN = /^\[\d{4}-\d{2}-\d{2}\]\s+.+/

const stripBoldMarkers = (line: string): string =>
  line.replace(/\*\*(.*?)\*\*/g, '$1')

const extractListItem = (line: string): string | null => {
  const normalized = stripBoldMarkers(line).trim()
  if (normalized === '') {
    return null
  }
  const bulletMatch = normalized.match(BULLET_LINE_PATTERN)
  if (bulletMatch) {
    const item = bulletMatch[1].trim()
    return item === '' ? null : item
  }
  const numberedMatch = normalized.match(NUMBERED_LINE_PATTERN)
  if (numberedMatch) {
    const item = numberedMatch[1].trim()
    return item === '' ? null : item
  }
  if (DATE_LINE_PATTERN.test(normalized)) {
    return normalized
  }
  return null
}

export function formatNoteForChunk(note: Note): string {
  const date = new Date(note.timestamp).toISOString().slice(0, 10)
  return `[${date}] ${note.content}\n  \u2192 activate when: ${note.when}`
}

export function formatChunkNotes(notes: Note[]): string {
  return notes.map(formatNoteForChunk).join('\n\n')
}

export function formatScatterSystemPrompt(chunkNotes: string): string {
  return [
    'You are a memory retrieval agent. You hold one segment of memory notes.',
    'Each note has content, an activation condition (when), and a timestamp.',
    '',
    '<chunk_notes>',
    chunkNotes,
    '</chunk_notes>'
  ].join('\n')
}

export function formatScatterUserPrompt(
  transcript: string,
  toolName: string,
  toolInput: string
): string {
  const truncatedInput = toolInput.slice(0, MAX_TOOL_INPUT_CHARS)
  return [
    '<structured_transcript>',
    transcript,
    '</structured_transcript>',
    '',
    '<upcoming_tool_call>',
    `Tool: ${toolName}`,
    `Input: ${truncatedInput}`,
    '</upcoming_tool_call>',
    '',
    'Look at each note\'s "activate when" condition. If the condition matches',
    'the transcript and upcoming tool call, extract the note\'s content as a',
    'candidate hint. Up to 3 candidates.',
    ...BULLET_LIST_FORMAT_INSTRUCTIONS
  ].join('\n')
}

export function formatSingleChunkUserPrompt(
  existingHints: string[],
  transcript: string,
  toolName: string,
  toolInput: string
): string {
  const truncatedInput = toolInput.slice(0, MAX_TOOL_INPUT_CHARS)
  const existing = existingHints.length > 0 ? existingHints.join('\n') : ''
  return [
    '<existing_memory_hints>',
    existing,
    '</existing_memory_hints>',
    '',
    '<structured_transcript>',
    transcript,
    '</structured_transcript>',
    '',
    '<upcoming_tool_call>',
    `Tool: ${toolName}`,
    `Input: ${truncatedInput}`,
    '</upcoming_tool_call>',
    '',
    'Look at each note\'s activation condition. Return 1-3 hints matching',
    'the transcript that are NOT already in existing_memory_hints.',
    ...BULLET_LIST_FORMAT_INSTRUCTIONS
  ].join('\n')
}

export function formatReducePrompt(
  existingHints: string[],
  candidates: string[],
  transcript: string
): string {
  const existing = existingHints.length > 0 ? existingHints.join('\n') : ''
  const formattedCandidates = candidates
    .map((candidate) => `- ${candidate}`)
    .join('\n')
  return [
    '<existing_memory_hints>',
    existing,
    '</existing_memory_hints>',
    '',
    '<candidates>',
    formattedCandidates,
    '</candidates>',
    '',
    '<structured_transcript>',
    transcript,
    '</structured_transcript>',
    '',
    'Return ONLY hints that are NOT already present in existing_memory_hints.',
    'Two hints are "the same" if they convey the same core fact, even if',
    'worded differently.',
    'If all candidates duplicate existing hints, return exactly: NONE',
    'Otherwise return 1-3 new hints.',
    ...BULLET_LIST_FORMAT_INSTRUCTIONS
  ].join('\n')
}

export function formatQueryUserPrompt(query: string, maxResults: number): string {
  return [
    '<query>',
    query,
    '</query>',
    '',
    'Look at each note\'s "activate when" condition and content. If the query',
    `matches, return up to ${maxResults} exact note lines in the format`,
    '"[YYYY-MM-DD] content".',
    ...QUERY_BULLET_LIST_FORMAT_INSTRUCTIONS
  ].join('\n')
}

export function parseBulletList(text: string): string[] {
  const trimmed = text.trim()
  if (trimmed === '' || trimmed.toUpperCase() === 'NONE') {
    return []
  }
  return trimmed
    .split('\n')
    .map(extractListItem)
    .filter((line): line is string => line !== null && line.length > 0)
}

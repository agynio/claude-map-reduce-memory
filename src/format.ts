import { MAX_TOOL_INPUT_CHARS } from './constants'
import type { Note } from './types'

const BULLET_LIST_FORMAT_INSTRUCTIONS = [
  'Respond ONLY with a plain dash-prefixed list. No numbers, no bold, no extra text.',
  'Format exactly:',
  '- first hint',
  '- second hint',
  'If nothing is relevant: NONE',
  'When uncertain, prefer NONE over a guess — but do not suppress notes',
  'whose activation condition clearly applies.'
]

const QUERY_BULLET_LIST_FORMAT_INSTRUCTIONS = [
  'Respond ONLY with a plain dash-prefixed list. No numbers, no bold, no extra text.',
  'Format exactly:',
  '- [2026-03-30] first hint',
  '- [2026-03-31] second hint',
  'If nothing is relevant to the query: NONE',
  'Do not guess or stretch — if the query has no clear connection to any',
  'note, return NONE.'
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
    'Check each note\'s "activate when" condition against the transcript and',
    'upcoming tool call. A note is relevant when the agent would benefit from',
    'knowing it right now — the condition\'s topic, file, or project overlaps',
    'with what the user is working on. Ignore notes whose condition describes',
    'an unrelated area. Up to 3 candidates.',
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
    'Check each note\'s "activate when" condition against the transcript and',
    'upcoming tool call. A note is relevant when the agent would benefit from',
    'knowing it right now — the condition\'s topic, file, or project overlaps',
    'with what the user is working on. Ignore notes whose condition describes',
    'an unrelated area.',
    'Return 1-3 hints that are NOT already in existing_memory_hints.',
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
    'First discard candidates that are not relevant to the structured_transcript.',
    'A candidate is relevant when the agent would benefit from knowing it right now.',
    'Then remove candidates already present in existing_memory_hints. Two hints are',
    '"the same" if they convey the same core fact, even if worded differently.',
    'If none survive, return exactly: NONE.',
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
    'Look at each note\'s "activate when" condition and content. A note is',
    'relevant when it clearly relates to the query\'s topic, file, project,',
    'or requested detail. Vague or nonsensical queries match nothing.',
    `If the query matches, return up to ${maxResults} exact note lines in the format`,
    '"[YYYY-MM-DD] content".',
    ...QUERY_BULLET_LIST_FORMAT_INSTRUCTIONS
  ].join('\n')
}

export function formatQueryReducePrompt(
  query: string,
  candidates: string[]
): string {
  const formattedCandidates = candidates
    .map((candidate) => `- ${candidate}`)
    .join('\n')
  return [
    '<query>',
    query,
    '</query>',
    '',
    '<candidates>',
    formattedCandidates,
    '</candidates>',
    '',
    'Keep only candidates that are clearly relevant to the query.',
    'If none are relevant, return exactly: NONE.',
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

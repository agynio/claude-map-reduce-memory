import { MAX_TOOL_INPUT_CHARS } from './constants'
import type { Note } from './types'

const BULLET_LIST_FORMAT_INSTRUCTIONS = [
  'Respond ONLY with a plain dash-prefixed list. No numbers, no bold, no extra text.',
  'Format exactly:',
  '- first hint',
  '- second hint',
  'If nothing matches: NONE'
]

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
    '<transcript>',
    transcript,
    '</transcript>',
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
    '<transcript>',
    transcript,
    '</transcript>',
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
  const numberedCandidates = candidates
    .map((candidate, index) => `${index + 1}. ${candidate}`)
    .join('\n')
  return [
    '<existing_memory_hints>',
    existing,
    '</existing_memory_hints>',
    '',
    '<candidates>',
    numberedCandidates,
    '</candidates>',
    '',
    '<transcript>',
    transcript,
    '</transcript>',
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
    'matches, return the exact note line in the format "[YYYY-MM-DD] content",',
    `prefixed "- ". Return up to ${maxResults}.`,
    ...BULLET_LIST_FORMAT_INSTRUCTIONS
  ].join('\n')
}

export function parseBulletList(text: string): string[] {
  const trimmed = text.trim()
  if (trimmed === '' || trimmed.toUpperCase() === 'NONE') {
    return []
  }
  const stripBoldMarkers = (line: string): string =>
    line.replace(/\*\*(.*?)\*\*/g, '$1').trim()
  const extractListItem = (line: string): string | null => {
    if (line === '') {
      return null
    }
    const bulletMatch = line.match(/^[-*]\s+(.*)$/)
    if (bulletMatch) {
      return bulletMatch[1]
    }
    const numberedMatch = line.match(/^\d+\.\s+(.*)$/)
    if (numberedMatch) {
      return numberedMatch[1]
    }
    if (/^\[\d{4}-\d{2}-\d{2}\]\s+.+/.test(line)) {
      return line
    }
    return null
  }
  return trimmed
    .split('\n')
    .map((line) => line.trim())
    .map(extractListItem)
    .filter((line): line is string => line !== null)
    .map(stripBoldMarkers)
    .filter((line) => line.length > 0)
}

import fs from 'node:fs/promises'
import path from 'node:path'

import { v4 as uuidv4 } from 'uuid'

import {
  BASE_DIR,
  CHUNKS_DIR,
  CONFIG_PATH,
  DEFAULT_CONFIG,
  STATE_PATH
} from './constants'
import { isNumber, isRecord } from './guards'
import { estimateTokens } from './tokens'
import type { Chunk, Config, Note, State } from './types'

const CHUNK_FILE_REGEX = /^chunk-(\d+)\.json$/

function chunkFilename(sequence: number): string {
  return `chunk-${String(sequence).padStart(3, '0')}.json`
}

async function readJsonFile(filePath: string): Promise<unknown> {
  const raw = await fs.readFile(filePath, 'utf8')
  return JSON.parse(raw) as unknown
}

async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + '\n')
}

function parseConfig(data: unknown): Config {
  if (!isRecord(data)) {
    throw new Error('Invalid config format')
  }
  const chunkTokenLimit = isNumber(data.chunkTokenLimit)
    ? data.chunkTokenLimit
    : DEFAULT_CONFIG.chunkTokenLimit
  const maxHints = isNumber(data.maxHints) ? data.maxHints : DEFAULT_CONFIG.maxHints
  const provider =
    data.provider === 'anthropic' || data.provider === 'openai'
      ? data.provider
      : DEFAULT_CONFIG.provider
  const lastReasoningPairs =
    isNumber(data.lastReasoningPairs) &&
    Number.isInteger(data.lastReasoningPairs) &&
    data.lastReasoningPairs > 0
      ? data.lastReasoningPairs
      : DEFAULT_CONFIG.lastReasoningPairs
  const model = typeof data.model === 'string' ? data.model : DEFAULT_CONFIG.model
  const apiKey =
    data.apiKey === null || data.apiKey === undefined
      ? null
      : typeof data.apiKey === 'string'
        ? data.apiKey
        : null

  return {
    chunkTokenLimit,
    maxHints,
    provider,
    model,
    apiKey,
    lastReasoningPairs
  }
}

function parseNote(data: unknown): Note {
  if (!isRecord(data)) {
    throw new Error('Invalid note entry')
  }
  if (
    typeof data.content !== 'string' ||
    typeof data.when !== 'string' ||
    !isNumber(data.timestamp) ||
    typeof data.id !== 'string' ||
    !isNumber(data.tokens)
  ) {
    throw new Error('Invalid note entry')
  }
  return {
    content: data.content,
    when: data.when,
    timestamp: data.timestamp,
    id: data.id,
    tokens: data.tokens
  }
}

function parseChunk(data: unknown): Chunk {
  if (!isRecord(data)) {
    throw new Error('Invalid chunk format')
  }
  const notes = Array.isArray(data.notes) ? data.notes.map(parseNote) : []
  const meta = isRecord(data.meta) ? data.meta : {}
  const totalTokens = isNumber(meta.totalTokens)
    ? meta.totalTokens
    : notes.reduce((sum, note) => sum + note.tokens, 0)
  return {
    notes,
    meta: {
      totalTokens
    }
  }
}

function parseState(data: unknown): State {
  if (!isRecord(data)) {
    throw new Error('Invalid state format')
  }
  if (!isNumber(data.nextChunkSequence) || !isNumber(data.totalNotes)) {
    throw new Error('Invalid state format')
  }
  return {
    nextChunkSequence: data.nextChunkSequence,
    totalNotes: data.totalNotes
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

export async function ensureBaseDirectories(): Promise<void> {
  await fs.mkdir(CHUNKS_DIR, { recursive: true })
}

export async function loadRawConfig(): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readJsonFile(CONFIG_PATH)
    if (!isRecord(raw)) {
      throw new Error('Invalid config format')
    }
    return raw
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        return null
      }
    }
    if (error instanceof SyntaxError) {
      throw new Error('Config file is not valid JSON')
    }
    throw error
  }
}

export async function loadConfigOrNull(): Promise<Config | null> {
  const raw = await loadRawConfig()
  if (!raw) {
    return null
  }
  return parseConfig(raw)
}

export async function loadConfig(): Promise<Config> {
  const config = await loadConfigOrNull()
  if (!config) {
    throw new Error('Config not found. Run "cmr-memory init".')
  }
  return config
}

export function detectConfigDrift(
  raw: Record<string, unknown>,
  parsed: Config
): boolean {
  return JSON.stringify(raw) !== JSON.stringify(parsed)
}

export async function saveConfig(config: Config): Promise<void> {
  await ensureBaseDirectories()
  await writeJsonFile(CONFIG_PATH, config)
}

export async function loadStateOrRebuild(): Promise<State> {
  try {
    const raw = await readJsonFile(STATE_PATH)
    return parseState(raw)
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        return rebuildStateFromChunks()
      }
    }
    if (error instanceof SyntaxError) {
      throw new Error('State file is not valid JSON')
    }
    throw error
  }
}

export async function saveState(state: State): Promise<void> {
  await ensureBaseDirectories()
  await writeJsonFile(STATE_PATH, state)
}

async function rebuildStateFromChunks(): Promise<State> {
  const chunks = await loadChunks()
  if (chunks.length === 0) {
    return {
      nextChunkSequence: 1,
      totalNotes: 0
    }
  }
  const totalNotes = chunks.reduce(
    (sum, entry) => sum + entry.chunk.notes.length,
    0
  )
  const nextChunkSequence = chunks[chunks.length - 1].sequence + 1
  return {
    nextChunkSequence,
    totalNotes
  }
}

export async function listChunkFiles(): Promise<
  Array<{ sequence: number; filename: string; filePath: string }>
> {
  try {
    const entries = await fs.readdir(CHUNKS_DIR)
    return entries
      .map((filename) => {
        const match = CHUNK_FILE_REGEX.exec(filename)
        if (!match) {
          return null
        }
        const sequence = Number.parseInt(match[1], 10)
        if (!Number.isFinite(sequence)) {
          return null
        }
        return {
          sequence,
          filename,
          filePath: path.join(CHUNKS_DIR, filename)
        }
      })
      .filter((entry): entry is { sequence: number; filename: string; filePath: string } =>
        Boolean(entry)
      )
      .sort((a, b) => a.sequence - b.sequence)
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        return []
      }
    }
    throw error
  }
}

export async function loadChunks(): Promise<
  Array<{ sequence: number; chunk: Chunk }>
> {
  const files = await listChunkFiles()
  const chunks = await Promise.all(
    files.map(async (entry) => {
      const raw = await readJsonFile(entry.filePath)
      return {
        sequence: entry.sequence,
        chunk: parseChunk(raw)
      }
    })
  )
  return chunks
}

async function writeChunk(sequence: number, chunk: Chunk): Promise<void> {
  await ensureBaseDirectories()
  const filePath = path.join(CHUNKS_DIR, chunkFilename(sequence))
  await writeJsonFile(filePath, chunk)
}

async function ensureInitialChunk(): Promise<{ sequence: number; chunk: Chunk }> {
  const chunks = await loadChunks()
  if (chunks.length > 0) {
    return chunks[chunks.length - 1]
  }
  const chunk: Chunk = {
    notes: [],
    meta: {
      totalTokens: 0
    }
  }
  await writeChunk(1, chunk)
  return { sequence: 1, chunk }
}

export function createNote(content: string, when: string): Note {
  const trimmedContent = content.trim()
  const trimmedWhen = when.trim()
  const tokens = estimateTokens(`${trimmedContent} ${trimmedWhen}`)
  return {
    id: uuidv4(),
    content: trimmedContent,
    when: trimmedWhen,
    timestamp: Date.now(),
    tokens
  }
}

export async function appendNote(
  content: string,
  when: string,
  config: Config
): Promise<Note> {
  const note = createNote(content, when)
  const latestChunkInfo = await ensureInitialChunk()
  const state = await loadStateOrRebuild()
  const baseNextSequence = Math.max(
    state.nextChunkSequence,
    latestChunkInfo.sequence + 1
  )

  const updatedNotes = [...latestChunkInfo.chunk.notes, note]
  const updatedTokens = latestChunkInfo.chunk.meta.totalTokens + note.tokens
  const updatedChunk: Chunk = {
    notes: updatedNotes,
    meta: {
      totalTokens: updatedTokens
    }
  }

  await writeChunk(latestChunkInfo.sequence, updatedChunk)

  let nextChunkSequence = baseNextSequence
  if (updatedTokens >= config.chunkTokenLimit) {
    const newSequence = baseNextSequence
    await writeChunk(newSequence, {
      notes: [],
      meta: {
        totalTokens: 0
      }
    })
    nextChunkSequence = newSequence + 1
  }

  await saveState({
    nextChunkSequence,
    totalNotes: state.totalNotes + 1
  })

  return note
}

export async function listNotes(limit: number): Promise<Note[]> {
  const chunks = await loadChunks()
  const notes = chunks.flatMap((chunk) => chunk.chunk.notes)
  notes.sort((a, b) => b.timestamp - a.timestamp)
  return notes.slice(0, limit)
}

export async function resetStore(): Promise<void> {
  const chunks = await listChunkFiles()
  await Promise.all(chunks.map((chunk) => fs.rm(chunk.filePath)))
  await saveState({ nextChunkSequence: 1, totalNotes: 0 })
}

export async function removeDataDirectory(): Promise<void> {
  await fs.rm(BASE_DIR, { recursive: true, force: true })
}

export async function calculateStorageBytes(): Promise<number> {
  const paths: string[] = []
  if (await fileExists(CONFIG_PATH)) {
    paths.push(CONFIG_PATH)
  }
  if (await fileExists(STATE_PATH)) {
    paths.push(STATE_PATH)
  }
  const chunkFiles = await listChunkFiles()
  paths.push(...chunkFiles.map((entry) => entry.filePath))

  const stats = await Promise.all(
    paths.map(async (filePath) => {
      const stat = await fs.stat(filePath)
      return stat.size
    })
  )

  return stats.reduce((sum, size) => sum + size, 0)
}

export async function ensureStateInitialized(): Promise<State> {
  const stateExists = await fileExists(STATE_PATH)
  if (stateExists) {
    return loadStateOrRebuild()
  }
  const chunks = await loadChunks()
  if (chunks.length === 0) {
    const state = { nextChunkSequence: 1, totalNotes: 0 }
    await saveState(state)
    return state
  }
  const totalNotes = chunks.reduce(
    (sum, entry) => sum + entry.chunk.notes.length,
    0
  )
  const state = {
    nextChunkSequence: chunks[chunks.length - 1].sequence + 1,
    totalNotes
  }
  await saveState(state)
  return state
}

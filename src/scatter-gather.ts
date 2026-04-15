import { MERGE_TIMEOUT, SCATTER_TIMEOUT } from './constants'
import {
  formatChunkNotes,
  formatQueryUserPrompt,
  formatReducePrompt,
  formatScatterSystemPrompt,
  formatScatterUserPrompt,
  formatSingleChunkUserPrompt,
  parseBulletList
} from './format'
import { createClient } from './llm'
import type { Chunk, Config } from './types'

const DEFAULT_MAX_TOKENS = 300

export async function gatherHookHints(params: {
  config: Config
  chunks: Array<{ sequence: number; chunk: Chunk }>
  transcript: string
  toolName: string
  toolInput: string
  existingHints: string[]
}): Promise<string[]> {
  if (!params.config.apiKey) {
    throw new Error('API key not configured')
  }
  const client = createClient(params.config)

  if (params.chunks.length === 1) {
    const chunkNotes = formatChunkNotes(params.chunks[0].chunk.notes)
    const system = formatScatterSystemPrompt(chunkNotes)
    const user = formatSingleChunkUserPrompt(
      params.existingHints,
      params.transcript,
      params.toolName,
      params.toolInput
    )
    const response = await client.complete({
      model: params.config.model,
      system,
      user,
      maxTokens: DEFAULT_MAX_TOKENS,
      timeoutMs: SCATTER_TIMEOUT
    })
    return parseBulletList(response).slice(0, params.config.maxHints)
  }

  const scatterResults = await Promise.allSettled(
    params.chunks.map(async (entry) => {
      const chunkNotes = formatChunkNotes(entry.chunk.notes)
      const system = formatScatterSystemPrompt(chunkNotes)
      const user = formatScatterUserPrompt(
        params.transcript,
        params.toolName,
        params.toolInput
      )
      const response = await client.complete({
        model: params.config.model,
        system,
        user,
        maxTokens: DEFAULT_MAX_TOKENS,
        timeoutMs: SCATTER_TIMEOUT
      })
      return parseBulletList(response)
    })
  )

  const candidates = scatterResults.flatMap((result) => {
    if (result.status === 'fulfilled') {
      return result.value
    }
    console.error(`Scatter failed: ${result.reason}`)
    return []
  })

  if (candidates.length === 0) {
    return []
  }

  try {
    const reducePrompt = formatReducePrompt(
      params.existingHints,
      candidates,
      params.transcript
    )
    const response = await client.complete({
      model: params.config.model,
      system:
        'You filter and deduplicate memory hints. Discard anything not directly relevant.',
      user: reducePrompt,
      maxTokens: DEFAULT_MAX_TOKENS,
      timeoutMs: MERGE_TIMEOUT
    })
    return parseBulletList(response).slice(0, params.config.maxHints)
  } catch (error) {
    console.error(`Reduce failed: ${error}`)
    return candidates.slice(0, params.config.maxHints)
  }
}

export async function gatherQueryResults(params: {
  config: Config
  chunks: Array<{ sequence: number; chunk: Chunk }>
  query: string
  maxResults: number
}): Promise<string[]> {
  if (!params.config.apiKey) {
    throw new Error('API key not configured')
  }
  const client = createClient(params.config)

  const results = await Promise.allSettled(
    params.chunks.map(async (entry) => {
      const chunkNotes = formatChunkNotes(entry.chunk.notes)
      const system = formatScatterSystemPrompt(chunkNotes)
      const user = formatQueryUserPrompt(params.query, params.maxResults)
      const response = await client.complete({
        model: params.config.model,
        system,
        user,
        maxTokens: DEFAULT_MAX_TOKENS,
        timeoutMs: SCATTER_TIMEOUT
      })
      return parseBulletList(response)
    })
  )

  return results.flatMap((result) => {
    if (result.status === 'fulfilled') {
      return result.value
    }
    console.error(`Scatter failed: ${result.reason}`)
    return []
  })
}

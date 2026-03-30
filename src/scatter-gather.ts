import Anthropic from '@anthropic-ai/sdk'

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
import { isRecord } from './guards'
import type { Chunk, Config } from './types'

const DEFAULT_MAX_TOKENS = 300

function extractTextFromResponse(response: { content: unknown }): string {
  if (!Array.isArray(response.content)) {
    return ''
  }
  return response.content
    .map((block) => {
      if (!isRecord(block)) {
        return ''
      }
      if (block.type === 'text' && typeof block.text === 'string') {
        return block.text
      }
      return ''
    })
    .join('')
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) {
        return
      }
      settled = true
      reject(new Error(`Timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    promise
      .then((value) => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timer)
        resolve(value)
      })
      .catch((error) => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timer)
        reject(error)
      })
  })
}

async function callAnthropic(
  client: Anthropic,
  model: string,
  system: string,
  user: string,
  timeoutMs: number
): Promise<string> {
  const response = await withTimeout(
    client.messages.create({
      model,
      max_tokens: DEFAULT_MAX_TOKENS,
      temperature: 0,
      system: [
        {
          type: 'text' as const,
          text: system,
          cache_control: { type: 'ephemeral' as const }
        }
      ],
      messages: [{ role: 'user', content: user }]
    }),
    timeoutMs
  )
  return extractTextFromResponse(response)
}

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
  const client = new Anthropic({ apiKey: params.config.apiKey })

  if (params.chunks.length === 1) {
    const chunkNotes = formatChunkNotes(params.chunks[0].chunk.notes)
    const system = formatScatterSystemPrompt(chunkNotes)
    const user = formatSingleChunkUserPrompt(
      params.existingHints,
      params.transcript,
      params.toolName,
      params.toolInput
    )
    const response = await callAnthropic(
      client,
      params.config.model,
      system,
      user,
      SCATTER_TIMEOUT
    )
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
      const response = await callAnthropic(
        client,
        params.config.model,
        system,
        user,
        SCATTER_TIMEOUT
      )
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
    const response = await callAnthropic(
      client,
      params.config.model,
      'You merge memory hints.',
      reducePrompt,
      MERGE_TIMEOUT
    )
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
  const client = new Anthropic({ apiKey: params.config.apiKey })

  const results = await Promise.allSettled(
    params.chunks.map(async (entry) => {
      const chunkNotes = formatChunkNotes(entry.chunk.notes)
      const system = formatScatterSystemPrompt(chunkNotes)
      const user = formatQueryUserPrompt(params.query, params.maxResults)
      const response = await callAnthropic(
        client,
        params.config.model,
        system,
        user,
        SCATTER_TIMEOUT
      )
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

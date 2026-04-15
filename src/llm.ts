import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'

import { isRecord } from './guards'
import type { Config } from './types'

export interface LLMClient {
  complete(args: {
    model: string
    system: string
    user: string
    maxTokens: number
    timeoutMs: number
  }): Promise<string>
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
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

function extractTextFromAnthropicResponse(response: { content: unknown }): string {
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

function requireApiKey(config: Config): string {
  if (!config.apiKey) {
    throw new Error('API key not configured')
  }
  return config.apiKey
}

function wrapProviderError(provider: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  return new Error(`${provider} request failed: ${message}`)
}

function createAnthropicClient(config: Config): LLMClient {
  const client = new Anthropic({ apiKey: requireApiKey(config) })
  return {
    complete: async ({ model, system, user, maxTokens, timeoutMs }) => {
      try {
        const response = await withTimeout(
          client.messages.create({
            model,
            max_tokens: maxTokens,
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
        return extractTextFromAnthropicResponse(response)
      } catch (error) {
        throw wrapProviderError('Anthropic', error)
      }
    }
  }
}

function createOpenAIClient(config: Config): LLMClient {
  const client = new OpenAI({ apiKey: requireApiKey(config) })
  return {
    complete: async ({ model, system, user, maxTokens, timeoutMs }) => {
      try {
        const response = await withTimeout(
          client.chat.completions.create({
            model,
            temperature: 0,
            max_tokens: maxTokens,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user }
            ]
          }),
          timeoutMs
        )
        return response.choices[0]?.message?.content ?? ''
      } catch (error) {
        throw wrapProviderError('OpenAI', error)
      }
    }
  }
}

export function createClient(config: Config): LLMClient {
  switch (config.provider) {
    case 'anthropic':
      return createAnthropicClient(config)
    case 'openai':
      return createOpenAIClient(config)
    default:
      throw new Error(`Unknown provider: ${config.provider}`)
  }
}

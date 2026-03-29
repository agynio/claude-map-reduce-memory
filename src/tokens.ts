import { TOKEN_ESTIMATE_DIVISOR } from './constants'

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / TOKEN_ESTIMATE_DIVISOR)
}

export function truncateToTokenLimit(text: string, maxTokens: number): string {
  const maxChars = maxTokens * TOKEN_ESTIMATE_DIVISOR
  if (text.length <= maxChars) {
    return text
  }
  return text.slice(text.length - maxChars)
}

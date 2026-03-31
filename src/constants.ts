import os from 'node:os'
import path from 'node:path'

import type { Config } from './types'

export const CHUNK_TOKEN_LIMIT = 20000
export const MAX_HINTS = 3
export const DEFAULT_MODEL = 'claude-haiku-4-5-20251001'
export const PRE_HOOK_TIMEOUT = 15000
export const SCATTER_TIMEOUT = 12000
export const MERGE_TIMEOUT = 5000
export const MAX_TRANSCRIPT_TOKENS = 2000
export const MAX_TOOL_INPUT_CHARS = 500
export const TOKEN_ESTIMATE_DIVISOR = 4
export const MEMORY_REMINDER_TEXT =
  'Did anything noteworthy just happen? If yes, use the memory skill to save it.'

export const BASE_DIR = path.join(os.homedir(), '.claude-memory')
export const CONFIG_PATH = path.join(BASE_DIR, 'config.json')
export const STATE_PATH = path.join(BASE_DIR, 'state.json')
export const CHUNKS_DIR = path.join(BASE_DIR, 'chunks')

export const CLAUDE_DIR = path.join(os.homedir(), '.claude')
export const SETTINGS_PATH = path.join(CLAUDE_DIR, 'settings.json')
export const CLAUDE_MD_PATH = path.join(CLAUDE_DIR, 'CLAUDE.md')

export const DEFAULT_CONFIG: Config = {
  chunkTokenLimit: CHUNK_TOKEN_LIMIT,
  maxHints: MAX_HINTS,
  model: DEFAULT_MODEL,
  apiKey: null
}

export interface Note {
  content: string
  when: string
  timestamp: number
  id: string
  tokens: number
}

export interface Chunk {
  notes: Note[]
  meta: {
    totalTokens: number
  }
}

export interface State {
  nextChunkSequence: number
  totalNotes: number
}

export interface Config {
  chunkTokenLimit: number
  maxHints: number
  model: string
  apiKey: string | null
}

export interface HookInput {
  session_id?: string
  tool_name?: string
  tool_input?: Record<string, unknown>
  transcript_path?: string
}

export interface HookCommandEntry {
  type: string
  command: string
  timeout?: number
}

export interface HookEventEntry {
  matcher: string
  hooks: HookCommandEntry[]
}

export interface SettingsFile {
  hooks?: Record<string, HookEventEntry[]>
  [key: string]: unknown
}

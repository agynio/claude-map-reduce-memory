import fs from 'node:fs/promises'
import path from 'node:path'

import { CLAUDE_MD_PATH } from './constants'

const SECTION_START = '<!-- cmr-memory:start -->'
const SECTION_END = '<!-- cmr-memory:end -->'
const SECTION_LINES = [
  SECTION_START,
  '## Memory',
  '',
  'Always use the memory skill (cmr-memory CLI) when you need to remember something or retrieve past context. Do not use the built-in MEMORY.md.',
  SECTION_END
]

type SectionRange = { start: number; end: number }

function detectLineEnding(content: string): string {
  return content.includes('\r\n') ? '\r\n' : '\n'
}

function buildSection(lineEnding: string): string {
  return SECTION_LINES.join(lineEnding)
}

function findSectionRange(content: string): SectionRange | null {
  const start = content.indexOf(SECTION_START)
  if (start === -1) {
    return null
  }
  const endMarker = content.indexOf(SECTION_END, start + SECTION_START.length)
  if (endMarker === -1) {
    return null
  }
  return { start, end: endMarker + SECTION_END.length }
}

function upsertSectionContent(content: string): string {
  const lineEnding = detectLineEnding(content)
  const section = buildSection(lineEnding)
  const range = findSectionRange(content)
  if (range) {
    return content.slice(0, range.start) + section + content.slice(range.end)
  }
  const separator = content.length === 0 || content.endsWith('\n') ? '' : lineEnding
  return `${content}${separator}${section}${lineEnding}`
}

function removeSectionContent(content: string): string {
  const range = findSectionRange(content)
  if (!range) {
    return content
  }
  return content.slice(0, range.start) + content.slice(range.end)
}

export async function upsertClaudeMdRule(): Promise<void> {
  let content = ''
  let exists = true
  try {
    content = await fs.readFile(CLAUDE_MD_PATH, 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        exists = false
      } else {
        throw error
      }
    } else {
      throw error
    }
  }

  const updated = upsertSectionContent(content)
  if (!exists || updated !== content) {
    await fs.mkdir(path.dirname(CLAUDE_MD_PATH), { recursive: true })
    await fs.writeFile(CLAUDE_MD_PATH, updated)
  }
}

export async function hasClaudeMdRule(): Promise<boolean> {
  try {
    const content = await fs.readFile(CLAUDE_MD_PATH, 'utf8')
    return findSectionRange(content) !== null
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        return false
      }
    }
    throw error
  }
}

export async function removeClaudeMdRule(): Promise<void> {
  let content = ''
  try {
    content = await fs.readFile(CLAUDE_MD_PATH, 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        return
      }
    }
    throw error
  }

  const updated = removeSectionContent(content)
  if (updated === content) {
    return
  }
  if (updated.trim().length === 0) {
    await fs.rm(CLAUDE_MD_PATH, { force: true })
    return
  }
  await fs.writeFile(CLAUDE_MD_PATH, updated)
}

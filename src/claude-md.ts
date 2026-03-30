import fs from 'node:fs/promises'
import path from 'node:path'

import { CLAUDE_MD_PATH } from './constants'

const SECTION_START = '<!-- cmr-memory:start -->'
const SECTION_END = '<!-- cmr-memory:end -->'
const SECTION_LINES = [
  SECTION_START,
  '## Memory',
  '',
  'When you need to retrieve or save memory, always use the /memory skill. Do not use the built-in MEMORY.md.',
  SECTION_END
]

type SectionRange = { start: number; end: number }

export function detectLineEnding(content: string): string {
  return content.includes('\r\n') ? '\r\n' : '\n'
}

export function buildSection(lineEnding: string): string {
  return SECTION_LINES.join(lineEnding)
}

export function findSectionRange(content: string): SectionRange | null {
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

export function upsertSectionContent(content: string): string {
  const lineEnding = detectLineEnding(content)
  const section = buildSection(lineEnding)
  const range = findSectionRange(content)
  if (range) {
    return content.slice(0, range.start) + section + content.slice(range.end)
  }
  const separator = content.length === 0 || content.endsWith('\n') ? '' : lineEnding
  return `${content}${separator}${section}${lineEnding}`
}

export function removeSectionContent(content: string): string {
  const range = findSectionRange(content)
  if (!range) {
    return content
  }
  let end = range.end
  if (content.slice(end, end + 2) === '\r\n') {
    end += 2
  } else if (content[end] === '\n') {
    end += 1
  }
  return content.slice(0, range.start) + content.slice(end)
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
      }
    }
    if (exists) {
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

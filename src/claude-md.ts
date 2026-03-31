import fs from 'node:fs/promises'
import path from 'node:path'

import { CLAUDE_MD_PATH } from './constants'

const SECTION_START = '<!-- cmr-memory:start -->'
const SECTION_END = '<!-- cmr-memory:end -->'
const SECTION_LINES = [
  SECTION_START,
  '# Memory',
  '',
  'You have persistent memory that survives across sessions via the `cmr-memory` CLI.',
  '',
  'When you need to retrieve or save memory, always use the `cmr-memory` CLI.',
  'Do not use the built-in MEMORY.md.',
  '',
  '## How It Works',
  '',
  '- **Automatic retrieval**: Before each tool call, relevant memories',
  '  appear as [MEMORY] blocks in your context. No action needed.',
  '- **Reminders**: After tool calls, you may see a short reminder to',
  '  consider saving noteworthy results. Use your judgment and save directly without asking the user.',
  '- **Explicit writes**: Run cmr-memory write when you make important',
  '  decisions or discover something worth remembering.',
  '- **Explicit search**: Run cmr-memory retrieve for specific past context.',
  '',
  '## Writing Memory',
  '',
  'Save important context:',
  '',
  '  cmr-memory write "your note here" --when "activation condition"',
  '',
  'The --when field is critical. It tells the memory system WHEN to surface',
  'this note. Include:',
  '- Project name for project-specific notes',
  '- File paths, module names, or topics that should trigger recall',
  '- Omit project name for universal knowledge (e.g. user preferences)',
  '',
  'Examples:',
  '  cmr-memory write "Auth expiry should be 900s not 3600s in config.ts" \\',
  '    --when "working on myapp, auth module, tokens, or editing config.ts"',
  '',
  '  cmr-memory write "User prefers tabs over spaces" \\',
  '    --when "any project, code formatting, editor settings"',
  '',
  '  cmr-memory write "Redis chosen for session storage over Postgres" \\',
  '    --when "working on dashboard project, session management, database decisions"',
  '',
  'Write memory for:',
  '- Decisions and rationale',
  '- Discovered bugs and root causes',
  '- Architecture facts and dependencies',
  '- User preferences and project conventions',
  '- Environment details and config values',
  '',
  "Don't write memory for:",
  '- Routine operations (file reads, standard test runs)',
  '- Info already in code comments or docs',
  '- Temporary debugging state',
  '',
  'Good notes are specific:',
  '- BAD: "Fixed the bug"',
  '- GOOD: "Fixed auth token refresh in src/auth/token.ts \u2014 expiry was',
  '  3600s, should be 900s per API spec"',
  '',
  'Include: file paths, error messages, decision rationale, config values.',
  '',
  '## Searching Memory',
  '',
  '  cmr-memory retrieve "query here" --max 5',
  '',
  '## Listing Recent Notes',
  '',
  '  cmr-memory list',
  '  cmr-memory list --limit 20',
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

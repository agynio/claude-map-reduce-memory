import fs from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline/promises'
import { execFile } from 'node:child_process'
import { stdin as input, stdout as output } from 'node:process'
import { promisify } from 'node:util'

import { getFlagValue, getPositionalArgs, parsePositiveInt } from './args'
import {
  BASE_DIR,
  DEFAULT_CONFIG,
  MEMORY_REMINDER_TEXT,
  PRE_HOOK_TIMEOUT,
  SKILL_DIR,
  SKILL_PATH
} from './constants'
import {
  hasHookEntry,
  loadSettingsFile,
  removeHookEntry,
  saveSettingsFile,
  upsertHookEntry
} from './settings'
import {
  appendNote,
  calculateStorageBytes,
  ensureBaseDirectories,
  ensureStateInitialized,
  listNotes,
  loadConfig,
  loadConfigOrNull,
  loadChunks,
  removeDataDirectory,
  resetStore,
  saveConfig
} from './store'
import type { HookEventEntry } from './types'
import { resolveRetrieveMode, runRetrieveHook, runRetrieveQuery } from './retrieve'
import { runRemind } from './remind'

const PRE_TOOL_COMMAND = 'claude-memory retrieve'
const POST_TOOL_COMMAND = 'claude-memory remind'
const execFileAsync = promisify(execFile)

const SKILL_CONTENT = `---
name: memory
description: Persistent memory across sessions. Memories auto-retrieved before tool calls. Use claude-memory CLI to save important context.
---

# Memory

You have persistent memory that survives across sessions via the \`claude-memory\` CLI.

## How It Works

- **Automatic retrieval**: Before each tool call, relevant memories
  appear as [MEMORY] blocks in your context. No action needed.
- **Reminders**: After tool calls, you may see a short reminder to
  consider saving noteworthy results. Use your judgment.
- **Explicit writes**: Run claude-memory write when you make important
  decisions or discover something worth remembering.
- **Explicit search**: Run claude-memory retrieve for specific past context.

## Writing Memory

Save important context:

  claude-memory write "your note here" --when "activation condition"

The --when field is critical. It tells the memory system WHEN to surface
this note. Include:
- Project name for project-specific notes
- File paths, module names, or topics that should trigger recall
- Omit project name for universal knowledge (e.g. user preferences)

Examples:
  claude-memory write "Auth expiry should be 900s not 3600s in config.ts" \\
    --when "working on myapp, auth module, tokens, or editing config.ts"

  claude-memory write "User prefers tabs over spaces" \\
    --when "any project, code formatting, editor settings"

  claude-memory write "Redis chosen for session storage over Postgres" \\
    --when "working on dashboard project, session management, database decisions"

Write memory for:
- Decisions and rationale
- Discovered bugs and root causes
- Architecture facts and dependencies
- User preferences and project conventions
- Environment details and config values

Don't write memory for:
- Routine operations (file reads, standard test runs)
- Info already in code comments or docs
- Temporary debugging state

Good notes are specific:
- BAD: "Fixed the bug"
- GOOD: "Fixed auth token refresh in src/auth/token.ts \u2014 expiry was
  3600s, should be 900s per API spec"

Include: file paths, error messages, decision rationale, config values.

## Searching Memory

  claude-memory retrieve "query here" --max 5

## Listing Recent Notes

  claude-memory list
  claude-memory list --limit 20
`

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => {
      data += chunk
    })
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', (error) => reject(error))
  })
}

function formatNotes(notes: Awaited<ReturnType<typeof listNotes>>): string {
  if (notes.length === 0) {
    return 'No notes yet.'
  }
  return notes
    .map((note) => {
      const date = new Date(note.timestamp).toISOString().slice(0, 10)
      return `[${date}] ${note.content}\n  when: ${note.when}`
    })
    .join('\n\n')
}

async function promptYesNo(message: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    return false
  }
  const rl = readline.createInterface({ input, output })
  try {
    const answer = await rl.question(message)
    return /^y(es)?$/i.test(answer.trim())
  } finally {
    rl.close()
  }
}

function maskApiKey(apiKey: string | null): string {
  if (!apiKey) {
    return 'not set'
  }
  if (apiKey.length <= 8) {
    return apiKey
  }
  return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`
}

async function loadPackageVersion(): Promise<string> {
  try {
    const packagePath = path.resolve(__dirname, '..', 'package.json')
    const raw = await fs.readFile(packagePath, 'utf8')
    const parsed = JSON.parse(raw) as { version?: string }
    return parsed.version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

async function isCommandAvailable(command: string): Promise<boolean> {
  try {
    await execFileAsync('which', [command])
    return true
  } catch {
    return false
  }
}

async function ensureGlobalInstall(): Promise<boolean> {
  if (await isCommandAvailable('claude-memory')) {
    return true
  }
  try {
    const packageRoot = path.resolve(__dirname, '..')
    await execFileAsync('npm', ['install', '-g', packageRoot])
  } catch (error) {
    console.error(`Global install failed: ${error}`)
    return false
  }
  return isCommandAvailable('claude-memory')
}

function preToolHookEntry(): HookEventEntry {
  return {
    matcher: '',
    hooks: [
      {
        type: 'command',
        command: PRE_TOOL_COMMAND,
        timeout: PRE_HOOK_TIMEOUT
      }
    ]
  }
}

function postToolHookEntry(): HookEventEntry {
  return {
    matcher: '',
    hooks: [
      {
        type: 'command',
        command: POST_TOOL_COMMAND
      }
    ]
  }
}

async function handleWrite(args: string[]): Promise<void> {
  const [content] = getPositionalArgs(args)
  const when = getFlagValue(args, '--when')
  if (!content) {
    throw new Error('Write requires note content as the first argument.')
  }
  if (!when) {
    throw new Error('Write requires --when "activation condition".')
  }
  const config = await loadConfig()
  await appendNote(content, when, config)
  console.log('Saved')
}

async function handleList(args: string[]): Promise<void> {
  const limit = parsePositiveInt(getFlagValue(args, '--limit'), 10)
  const notes = await listNotes(limit)
  console.log(formatNotes(notes))
}

async function handleRetrieve(args: string[]): Promise<void> {
  const mode = resolveRetrieveMode(args, process.stdin.isTTY)
  if (mode.mode === 'query') {
    const output = await runRetrieveQuery(mode.query, mode.maxResults)
    console.log(output)
    return
  }
  if (mode.mode === 'hook') {
    const rawInput = await readStdin()
    const output = await runRetrieveHook(rawInput)
    process.stdout.write(output)
    return
  }
  throw new Error(mode.message)
}

async function handleInit(args: string[]): Promise<void> {
  const apiKeyFlag = getFlagValue(args, '--api-key')
  if (apiKeyFlag === 'off') {
    throw new Error('init requires a valid API key')
  }
  const envApiKey = process.env.ANTHROPIC_API_KEY
  const existingConfig = await loadConfigOrNull()
  const apiKey = apiKeyFlag ?? envApiKey ?? existingConfig?.apiKey
  if (!apiKey) {
    throw new Error('API key required. Use --api-key or ANTHROPIC_API_KEY.')
  }

  const cliInstalled = await ensureGlobalInstall()
  await ensureBaseDirectories()
  if (!existingConfig) {
    await saveConfig({ ...DEFAULT_CONFIG, apiKey })
  } else if (apiKeyFlag && apiKeyFlag !== existingConfig.apiKey) {
    await saveConfig({ ...existingConfig, apiKey })
  }
  await ensureStateInitialized()

  const settings = await loadSettingsFile()
  const withPre = upsertHookEntry(
    settings,
    'PreToolUse',
    preToolHookEntry(),
    PRE_TOOL_COMMAND
  )
  const withPost = upsertHookEntry(
    withPre,
    'PostToolUse',
    postToolHookEntry(),
    POST_TOOL_COMMAND
  )
  await saveSettingsFile(withPost)

  await fs.mkdir(SKILL_DIR, { recursive: true })
  await fs.writeFile(SKILL_PATH, SKILL_CONTENT)

  const version = await loadPackageVersion()
  const config = await loadConfig()
  const checkMark = '\u2713'
  const warnMark = '\u26A0'
  console.log(`claude-memory v${version}`)
  console.log('')
  console.log(
    `  ${cliInstalled ? checkMark : warnMark} CLI installed globally`
  )
  console.log(`  ${checkMark} Data directory: ${BASE_DIR}`)
  console.log(`  ${checkMark} PreToolUse hook registered`)
  console.log(`  ${checkMark} PostToolUse hook registered (reminder: on)`)
  console.log(`  ${checkMark} Skill installed: ${SKILL_PATH}`)
  console.log(`  ${checkMark} Auth: API key (${maskApiKey(config.apiKey)})`)
  console.log('')
  console.log('Ready. Start a Claude Code session to begin building memory.')
  console.log('')
  console.log('Tip: To update the API key:')
  console.log('  claude-memory config --api-key sk-ant-...')
}

async function handleStatus(): Promise<void> {
  const config = await loadConfig()
  const chunks = await loadChunks()
  const totalNotes = chunks.reduce(
    (sum, entry) => sum + entry.chunk.notes.length,
    0
  )
  const latest = chunks[chunks.length - 1]
  const storageBytes = await calculateStorageBytes()
  const settings = await loadSettingsFile()
  const reminderOn = hasHookEntry(
    settings,
    'PostToolUse',
    POST_TOOL_COMMAND
  )

  console.log('Memory Status:')
  console.log(`  Notes:      ${totalNotes}`)
  console.log(
    `  Chunks:     ${chunks.length}${
      chunks.length > 0
        ? ` (${chunks.map((entry) => `chunk-${String(entry.sequence).padStart(3, '0')}`).join(', ')})`
        : ''
    }`
  )
  if (latest) {
    console.log(
      `  Latest:     chunk-${String(latest.sequence).padStart(3, '0')} (${latest.chunk.notes.length} notes, ~${latest.chunk.meta.totalTokens} tokens)`
    )
  }
  console.log(`  Storage:    ${storageBytes} bytes`)
  console.log(`  Reminder:   ${reminderOn ? 'on' : 'off'}`)
  console.log(`  Auth:       API key (${maskApiKey(config.apiKey)})`)
}

async function handleConfig(args: string[]): Promise<void> {
  const apiKeyValue = getFlagValue(args, '--api-key')
  const maxHintsValue = getFlagValue(args, '--max-hints')
  const reminderValue = getFlagValue(args, '--reminder')

  const config = await loadConfig()
  let configChanged = false

  if (apiKeyValue !== undefined) {
    if (apiKeyValue.toLowerCase() === 'off') {
      config.apiKey = null
    } else {
      config.apiKey = apiKeyValue
    }
    configChanged = true
  }

  if (maxHintsValue !== undefined) {
    const parsed = Number.parseInt(maxHintsValue, 10)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error('max-hints must be a positive integer')
    }
    config.maxHints = parsed
    configChanged = true
  }

  if (configChanged) {
    await saveConfig(config)
  }

  if (reminderValue !== undefined) {
    const settings = await loadSettingsFile()
    if (reminderValue === 'off') {
      const updated = removeHookEntry(
        settings,
        'PostToolUse',
        POST_TOOL_COMMAND
      )
      await saveSettingsFile(updated)
    } else if (reminderValue === 'on') {
      const updated = upsertHookEntry(
        settings,
        'PostToolUse',
        postToolHookEntry(),
        POST_TOOL_COMMAND
      )
      await saveSettingsFile(updated)
    } else {
      throw new Error('reminder must be "on" or "off"')
    }
  }

  if (!configChanged && reminderValue === undefined) {
    console.log('Config:')
    console.log(`  chunkTokenLimit: ${config.chunkTokenLimit}`)
    console.log(`  maxHints:        ${config.maxHints}`)
    console.log(`  model:           ${config.model}`)
    console.log(`  apiKey:          ${maskApiKey(config.apiKey)}`)
    return
  }

  console.log('Updated configuration.')
}

async function handleReset(args: string[]): Promise<void> {
  const confirmValue = getFlagValue(args, '--confirm')
  const confirmed =
    args.includes('--confirm') ||
    ['true', 'yes', '1'].includes((confirmValue ?? '').toLowerCase())
  if (!confirmed) {
    throw new Error('reset requires --confirm')
  }
  await resetStore()
  console.log('Memory reset complete.')
}

async function handleUninstall(): Promise<void> {
  const settings = await loadSettingsFile()
  const withoutPre = removeHookEntry(
    settings,
    'PreToolUse',
    PRE_TOOL_COMMAND
  )
  const withoutPost = removeHookEntry(
    withoutPre,
    'PostToolUse',
    POST_TOOL_COMMAND
  )
  await saveSettingsFile(withoutPost)

  await fs.rm(SKILL_DIR, { recursive: true, force: true })

  const removeData = await promptYesNo(
    `Remove data directory at ${BASE_DIR}? (y/N) `
  )
  if (removeData) {
    await removeDataDirectory()
  }

  try {
    await execFileAsync('npm', ['uninstall', '-g', 'claude-memory'])
  } catch (error) {
    console.error(`Global uninstall skipped: ${error}`)
  }

  console.log('Uninstall complete.')
}

async function handleRemind(): Promise<void> {
  if (process.stdin.isTTY) {
    console.error('remind expects hook JSON via stdin')
    return
  }
  const rawInput = await readStdin()
  const output = await runRemind(rawInput)
  if (output) {
    process.stdout.write(output)
  }
}

function printHelp(): void {
  console.log('claude-memory')
  console.log('')
  console.log('Usage:')
  console.log('  claude-memory write "note" --when "condition"')
  console.log('  claude-memory retrieve "query" --max 5')
  console.log('  claude-memory list --limit 10')
  console.log('  claude-memory init --api-key sk-ant-...')
  console.log('  claude-memory status')
  console.log('  claude-memory config [--api-key KEY] [--max-hints N] [--reminder on|off]')
  console.log('  claude-memory reset --confirm')
  console.log('  claude-memory uninstall')
  console.log('  claude-memory remind')
  console.log('')
  console.log(`PostToolUse reminder text: ${MEMORY_REMINDER_TEXT}`)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const command = args[0]
  const rest = args.slice(1)

  if (!command || command === '--help' || command === '-h') {
    printHelp()
    return
  }

  switch (command) {
    case 'write':
      await handleWrite(rest)
      return
    case 'retrieve':
      await handleRetrieve(rest)
      return
    case 'list':
      await handleList(rest)
      return
    case 'init':
      await handleInit(rest)
      return
    case 'status':
      await handleStatus()
      return
    case 'config':
      await handleConfig(rest)
      return
    case 'reset':
      await handleReset(rest)
      return
    case 'uninstall':
      await handleUninstall()
      return
    case 'remind':
      await handleRemind()
      return
    default:
      throw new Error(`Unknown command: ${command}`)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})

import fs from 'node:fs/promises'
import path from 'node:path'

import { SETTINGS_PATH } from './constants'
import type { HookEventEntry, SettingsFile } from './types'

const COMMAND_KEY = 'command'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function loadSettingsFile(): Promise<SettingsFile> {
  try {
    const raw = await fs.readFile(SETTINGS_PATH, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed)) {
      throw new Error('settings.json is not an object')
    }
    return parsed as SettingsFile
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        return {}
      }
    }
    throw error
  }
}

export async function saveSettingsFile(settings: SettingsFile): Promise<void> {
  await fs.mkdir(path.dirname(SETTINGS_PATH), { recursive: true })
  await fs.writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n')
}

export function upsertHookEntry(
  settings: SettingsFile,
  eventName: string,
  entry: HookEventEntry,
  command: string
): SettingsFile {
  const hooks = isRecord(settings.hooks) ? settings.hooks : {}
  const current = Array.isArray(hooks[eventName]) ? hooks[eventName] : []
  let replaced = false

  const updated = current.map((existing) => {
    if (
      existing &&
      Array.isArray(existing.hooks) &&
      existing.hooks.some((hook) =>
        isRecord(hook) ? hook[COMMAND_KEY] === command : false
      )
    ) {
      replaced = true
      return entry
    }
    return existing
  })

  if (!replaced) {
    updated.push(entry)
  }

  return {
    ...settings,
    hooks: {
      ...hooks,
      [eventName]: updated
    }
  }
}

export function removeHookEntry(
  settings: SettingsFile,
  eventName: string,
  command: string
): SettingsFile {
  const hooks = isRecord(settings.hooks) ? settings.hooks : {}
  const current = Array.isArray(hooks[eventName]) ? hooks[eventName] : []
  const filtered = current.filter((entry) => {
    if (!entry || !Array.isArray(entry.hooks)) {
      return true
    }
    return !entry.hooks.some((hook) =>
      isRecord(hook) ? hook[COMMAND_KEY] === command : false
    )
  })

  const nextHooks = { ...hooks }
  if (filtered.length === 0) {
    delete nextHooks[eventName]
  } else {
    nextHooks[eventName] = filtered
  }

  return {
    ...settings,
    hooks: nextHooks
  }
}

export function hasHookEntry(
  settings: SettingsFile,
  eventName: string,
  command: string
): boolean {
  if (!isRecord(settings.hooks)) {
    return false
  }
  const entries = settings.hooks[eventName]
  if (!Array.isArray(entries)) {
    return false
  }
  return entries.some((entry) =>
    entry &&
    Array.isArray(entry.hooks) &&
    entry.hooks.some((hook) =>
      isRecord(hook) ? hook[COMMAND_KEY] === command : false
    )
  )
}

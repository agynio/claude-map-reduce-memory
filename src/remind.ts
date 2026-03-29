import { MEMORY_REMINDER_TEXT } from './constants'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function shouldSkip(toolName: string, toolInput: Record<string, unknown>): boolean {
  if (toolName !== 'Bash') {
    return false
  }
  const command =
    typeof toolInput.command === 'string' ? toolInput.command : ''
  return command.includes('claude-memory')
}

export async function runRemind(rawInput: string): Promise<string> {
  try {
    const parsed = JSON.parse(rawInput) as unknown
    if (!isRecord(parsed)) {
      return ''
    }
    const toolName = typeof parsed.tool_name === 'string' ? parsed.tool_name : ''
    const toolInput = isRecord(parsed.tool_input) ? parsed.tool_input : {}
    if (toolName && shouldSkip(toolName, toolInput)) {
      return ''
    }

    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: MEMORY_REMINDER_TEXT
      }
    })
  } catch (error) {
    console.error(`Remind error: ${error}`)
    return ''
  }
}

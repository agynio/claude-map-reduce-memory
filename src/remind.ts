import { MEMORY_REMINDER_TEXT } from './constants'
import { isRecord } from './guards'
import { isClaudeMemoryCommand } from './hooks'

export async function runRemind(rawInput: string): Promise<string> {
  try {
    const parsed = JSON.parse(rawInput) as unknown
    if (!isRecord(parsed)) {
      return ''
    }
    const toolName = typeof parsed.tool_name === 'string' ? parsed.tool_name : ''
    const toolInput = isRecord(parsed.tool_input) ? parsed.tool_input : {}
    if (isClaudeMemoryCommand(toolName, toolInput)) {
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

export function isClaudeMemoryCommand(
  toolName: string,
  toolInput: Record<string, unknown>
): boolean {
  if (toolName !== 'Bash') {
    return false
  }
  const command = typeof toolInput.command === 'string' ? toolInput.command : ''
  return command.includes('claude-memory')
}

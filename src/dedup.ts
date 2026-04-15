export function extractExistingHints(transcript: string): string[] {
  const reminderRegex = /<system-reminder>([\s\S]*?)<\/system-reminder>/g
  const hints: string[] = []
  let match: RegExpExecArray | null
  while ((match = reminderRegex.exec(transcript)) !== null) {
    const lines = match[1].split(/\r?\n/)
    for (const line of lines) {
      const index = line.indexOf('[MEMORY]')
      if (index === -1) {
        continue
      }
      const hint = line.slice(index + '[MEMORY]'.length).trim()
      if (hint.length > 0) {
        hints.push(hint)
      }
    }
  }
  return hints
}

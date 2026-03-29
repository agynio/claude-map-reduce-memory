export function extractExistingHints(transcript: string): string[] {
  const reminderRegex =
    /<system-reminder>[\s\S]*?\[MEMORY\]([\s\S]*?)<\/system-reminder>/g
  const hints: string[] = []
  let match: RegExpExecArray | null
  while ((match = reminderRegex.exec(transcript)) !== null) {
    const hint = match[1].trim()
    if (hint.length > 0) {
      hints.push(hint)
    }
  }
  return hints
}

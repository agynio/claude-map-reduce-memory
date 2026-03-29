export function getFlagValue(args: string[], flag: string): string | undefined {
  const prefix = `${flag}=`
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === flag) {
      return args[i + 1]
    }
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length)
    }
  }
  return undefined
}

export function getPositionalArgs(args: string[]): string[] {
  return args.filter((arg) => !arg.startsWith('-'))
}

export function parsePositiveInt(
  value: string | undefined,
  fallback: number
): number {
  if (!value) {
    return fallback
  }
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }
  return parsed
}

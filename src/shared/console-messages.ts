import type { BrowserConsoleMessage } from './types.js'

export const BROWSER_CONSOLE_LEVELS = ['all', 'error', 'warning', 'info', 'verbose'] as const
export type BrowserConsoleLevelFilter = (typeof BROWSER_CONSOLE_LEVELS)[number]

export function browserConsoleLevel(level: string): Exclude<BrowserConsoleLevelFilter, 'all'> {
  const normalized = level.toLocaleLowerCase()
  if (normalized === 'error') return 'error'
  if (normalized === 'warning' || normalized === 'warn') return 'warning'
  if (normalized === 'verbose' || normalized === 'debug') return 'verbose'
  return 'info'
}

export function consoleMessageOccurrences(message: BrowserConsoleMessage): number {
  return Number.isFinite(message.repeatCount) && (message.repeatCount as number) >= 1
    ? Math.floor(message.repeatCount as number)
    : 1
}

export function countConsoleEvents(messages: BrowserConsoleMessage[]): number {
  return messages.reduce((total, message) => total + consoleMessageOccurrences(message), 0)
}

function consoleStacksMatch(left: BrowserConsoleMessage, right: BrowserConsoleMessage): boolean {
  if (left.stackTruncated !== right.stackTruncated) return false
  const leftStack = left.stack ?? []
  const rightStack = right.stack ?? []
  if (leftStack.length !== rightStack.length) return false
  return leftStack.every((frame, index) => {
    const other = rightStack[index]
    return other !== undefined
      && frame.functionName === other.functionName
      && frame.url === other.url
      && frame.lineNumber === other.lineNumber
      && frame.columnNumber === other.columnNumber
      && frame.async === other.async
  })
}

export function mergeRepeatedConsoleMessage(
  previous: BrowserConsoleMessage | undefined,
  incoming: BrowserConsoleMessage
): BrowserConsoleMessage | undefined {
  if (
    !previous
    || previous.kind !== 'console'
    || incoming.kind !== 'console'
    || !consoleStacksMatch(previous, incoming)
    || /^uncaught(?:\s+\(in promise\))?\s*:?/i.test(previous.message)
    || /^uncaught(?:\s+\(in promise\))?\s*:?/i.test(incoming.message)
    || previous.level.toLocaleLowerCase() !== incoming.level.toLocaleLowerCase()
    || previous.message !== incoming.message
    || previous.sourceId !== incoming.sourceId
    || previous.lineNumber !== incoming.lineNumber
    || previous.columnNumber !== incoming.columnNumber
  ) return undefined

  return {
    ...previous,
    timestamp: incoming.timestamp,
    firstTimestamp: previous.firstTimestamp ?? previous.timestamp,
    repeatCount: consoleMessageOccurrences(previous) + consoleMessageOccurrences(incoming)
  }
}

export function filterConsoleMessages(
  messages: BrowserConsoleMessage[],
  query: string,
  level: BrowserConsoleLevelFilter
): BrowserConsoleMessage[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  return messages
    .filter((message) => level === 'all' || browserConsoleLevel(message.level) === level)
    .filter((message) => !normalizedQuery
      || message.message.toLocaleLowerCase().includes(normalizedQuery)
      || message.sourceId.toLocaleLowerCase().includes(normalizedQuery)
      || message.stack?.some((frame) => (
        frame.functionName?.toLocaleLowerCase().includes(normalizedQuery)
        || frame.url?.toLocaleLowerCase().includes(normalizedQuery)
      )))
    .slice()
    .reverse()
}

export function countConsoleMessages(messages: BrowserConsoleMessage[]): Record<Exclude<BrowserConsoleLevelFilter, 'all'>, number> {
  const counts = { error: 0, warning: 0, info: 0, verbose: 0 }
  for (const message of messages) counts[browserConsoleLevel(message.level)] += consoleMessageOccurrences(message)
  return counts
}

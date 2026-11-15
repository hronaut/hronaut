import { browserConsoleLevel, mergeRepeatedConsoleMessage } from '../../../shared/console-messages.js'
import { sanitizeConsoleMessage } from '../../../shared/debug-report.js'
import type { BrowserConsoleMessage } from '../../../shared/types.js'
import type { Browser } from '../browser.js'
import { getTab } from '../browser-core.js'

/** The capture paths that can report a console message; one message can arrive through several. */
export type BrowserConsoleCaptureSource = 'electron' | 'runtime-console' | 'runtime' | 'log' | 'preload' | 'lifecycle'

/** A captured console message, with the runtime's formatted presentation when it has one. */
export interface ConsoleCapture extends BrowserConsoleMessage {
  presentation?: string
}

/** A retained console message, with the capture paths that reported it and its observation generation. */
export interface BrowserConsoleMessageRecord extends ConsoleCapture {
  captureSources: Set<BrowserConsoleCaptureSource>
  observationGeneration: number
}

/**
 * The tab fields console messages read and write. The retained and pending
 * messages belong to the tab, so the browser's navigation, observation and
 * close handling stay authoritative for clearing them.
 */
export interface ConsoleMessagesTab {
  observationGeneration: number
  consoleMessages: BrowserConsoleMessageRecord[]
  pendingRuntimeConsoleMessages: ConsoleCapture[]
}

/**
 * The tab's console messages for its current observation generation, with
 * capture bookkeeping removed and each message sanitized. With clear, the
 * retained and pending runtime messages are dropped after they are read.
 */
export function consoleMessages(browser: Browser, tabId?: string, clear = false): BrowserConsoleMessage[] {
  const tab = getTab(browser, tabId)
  const messages = tab.consoleMessages
    .filter(message => message.observationGeneration === tab.observationGeneration)
    .map((message) => {
      const { captureSources: _captureSources, presentation, ...publicMessage } = message
      return {
        ...sanitizeConsoleMessage({
          ...publicMessage,
          ...(presentation !== undefined ? { message: presentation } : {}),
          ...(publicMessage.stack ? { stack: publicMessage.stack.map((frame) => ({ ...frame })) } : {})
        }),
        observationGeneration: message.observationGeneration
      }
    })
  if (clear) {
    tab.consoleMessages = []
    tab.pendingRuntimeConsoleMessages = []
  }
  return messages
}

function consoleDedupeKey(message: string): string {
  return message
    .replace(/^uncaught(?:\s+\(in promise\))?\s*:?\s*/i, '')
    .replace(/^assertion failed\s*:?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase()
}

function consoleCapturesMatch(left: BrowserConsoleMessage, right: BrowserConsoleMessage): boolean {
  const leftTime = Date.parse(left.timestamp)
  const rightTime = Date.parse(right.timestamp)
  return Number.isFinite(leftTime)
    && Number.isFinite(rightTime)
    && Math.abs(leftTime - rightTime) <= 1_500
    && browserConsoleLevel(left.level) === browserConsoleLevel(right.level)
    && left.sourceId === right.sourceId
    && Math.abs(left.lineNumber - right.lineNumber) <= 1
    && consoleDedupeKey(left.message) === consoleDedupeKey(right.message)
}

function coalesceConsoleMessageWithPrevious(tab: ConsoleMessagesTab, message: BrowserConsoleMessageRecord): void {
  const index = tab.consoleMessages.indexOf(message)
  if (index <= 0) return
  const previous = tab.consoleMessages[index - 1]
  if (previous?.observationGeneration !== message.observationGeneration) return
  const grouped = mergeRepeatedConsoleMessage(previous, message)
  if (!previous || !grouped) return
  Object.assign(previous, grouped)
  for (const source of message.captureSources) previous.captureSources.add(source)
  tab.consoleMessages.splice(index, 1)
}

/**
 * Records a Runtime.consoleAPICalled capture: it enriches a matching recent
 * console message, or waits briefly among the pending runtime messages for the
 * matching Electron console event.
 */
export function retainRuntimeConsoleMessage(tab: ConsoleMessagesTab, input: ConsoleCapture): void {
  const message = sanitizeConsoleMessage(input)
  const existing = [...tab.consoleMessages].reverse().slice(0, 8).find((candidate) => (
    candidate.observationGeneration === tab.observationGeneration
    && candidate.kind === 'console'
    && !candidate.captureSources.has('runtime-console')
    && consoleCapturesMatch(candidate, message)
  ))
  if (existing) {
    Object.assign(existing, {
      ...(input.presentation !== undefined ? { presentation: input.presentation } : {}),
      ...(message.columnNumber !== undefined ? { columnNumber: message.columnNumber } : {}),
      ...(message.stack ? { stack: message.stack.map((frame) => ({ ...frame })) } : {}),
      ...(message.stackTruncated ? { stackTruncated: true } : {})
    })
    existing.captureSources.add('runtime-console')
    coalesceConsoleMessageWithPrevious(tab, existing)
    return
  }

  const cutoff = Date.now() - 2_000
  tab.pendingRuntimeConsoleMessages = tab.pendingRuntimeConsoleMessages
    .filter((candidate) => Date.parse(candidate.timestamp) >= cutoff)
  tab.pendingRuntimeConsoleMessages.push(message)
  if (tab.pendingRuntimeConsoleMessages.length > 24) {
    tab.pendingRuntimeConsoleMessages.splice(0, tab.pendingRuntimeConsoleMessages.length - 24)
  }
}

/**
 * Sanitizes an Electron console event and, when a pending runtime capture
 * matches it, takes that capture and merges its presentation, column and stack.
 */
export function withPendingRuntimeConsoleMessage(tab: ConsoleMessagesTab, input: BrowserConsoleMessage): {
  message: ConsoleCapture
  runtimeMatched: boolean
} {
  const message = sanitizeConsoleMessage(input)
  const matchIndex = tab.pendingRuntimeConsoleMessages.findIndex((candidate) => (
    consoleCapturesMatch(candidate, message)
  ))
  if (matchIndex < 0) return { message, runtimeMatched: false }
  const runtimeMessage = tab.pendingRuntimeConsoleMessages.splice(matchIndex, 1)[0]
  if (!runtimeMessage) return { message, runtimeMatched: false }
  return {
    runtimeMatched: true,
    message: {
      ...message,
      ...(runtimeMessage.presentation !== undefined ? { presentation: runtimeMessage.presentation } : {}),
      ...(runtimeMessage.columnNumber !== undefined ? { columnNumber: runtimeMessage.columnNumber } : {}),
      ...(runtimeMessage.stack ? { stack: runtimeMessage.stack.map((frame) => ({ ...frame })) } : {}),
      ...(runtimeMessage.stackTruncated ? { stackTruncated: true } : {})
    }
  }
}

/**
 * Appends a captured console message to the tab, merging it into a matching
 * recent exception or a repeated Electron console message, and keeps the last
 * 500 messages.
 */
export function appendConsoleMessage(
  tab: ConsoleMessagesTab,
  input: ConsoleCapture,
  source: BrowserConsoleCaptureSource
): void {
  const message = sanitizeConsoleMessage(input)
  if (message.kind === 'exception' || tab.consoleMessages.some((candidate) => candidate.kind === 'exception')) {
    const messageTime = Date.parse(message.timestamp)
    const match = [...tab.consoleMessages].reverse().slice(0, 8).find((candidate) => {
      if (candidate.observationGeneration !== tab.observationGeneration) return false
      if (message.kind !== 'exception' && candidate.kind !== 'exception') return false
      if (candidate.captureSources.has(source)) return false
      const candidateTime = Date.parse(candidate.timestamp)
      return Number.isFinite(messageTime)
        && Number.isFinite(candidateTime)
        && Math.abs(messageTime - candidateTime) <= 1_500
        && candidate.sourceId === message.sourceId
        && Math.abs(candidate.lineNumber - message.lineNumber) <= 1
        && consoleDedupeKey(candidate.message) === consoleDedupeKey(message.message)
    })
    if (match) {
      const exception = message.kind === 'exception' ? message : match
      Object.assign(match, message, exception, {
        timestamp: exception.timestamp,
        kind: 'exception'
      })
      match.captureSources.add(source)
      return
    }
  }

  const previous = tab.consoleMessages.at(-1)
  const grouped = source === 'electron' && previous?.observationGeneration === tab.observationGeneration
    ? mergeRepeatedConsoleMessage(previous, message)
    : undefined
  if (grouped && previous) {
    Object.assign(previous, grouped)
    previous.captureSources.add(source)
    return
  }

  tab.consoleMessages.push({
    ...message,
    observationGeneration: tab.observationGeneration,
    captureSources: new Set([source])
  })
  if (tab.consoleMessages.length > 500) tab.consoleMessages.splice(0, tab.consoleMessages.length - 500)
}

import { describe, expect, it } from 'vitest'
import {
  browserConsoleLevel,
  countConsoleEvents,
  countConsoleMessages,
  filterConsoleMessages,
  mergeRepeatedConsoleMessage
} from '../src/shared/console-messages.js'
import type { BrowserConsoleMessage } from '../src/shared/types.js'

const messages: BrowserConsoleMessage[] = [
  { timestamp: '2026-08-15T10:00:00.000Z', level: 'info', message: 'App ready', lineNumber: 3, sourceId: 'app.js' },
  { timestamp: '2026-08-15T10:00:01.000Z', level: 'warning', message: 'Slow request', lineNumber: 8, sourceId: 'network.js' },
  { timestamp: '2026-08-15T10:00:02.000Z', level: 'debug', message: 'Cache details', lineNumber: 12, sourceId: 'cache.js' },
  {
    timestamp: '2026-08-15T10:00:03.000Z',
    level: 'error',
    message: 'Request failed',
    lineNumber: 18,
    sourceId: 'network.js',
    stack: [{ functionName: 'loadProfile', url: 'app.js', lineNumber: 18, columnNumber: 4 }]
  }
]

describe('Console message helpers', () => {
  it('maps Chromium and console aliases to four human-facing levels', () => {
    expect(browserConsoleLevel('error')).toBe('error')
    expect(browserConsoleLevel('warn')).toBe('warning')
    expect(browserConsoleLevel('debug')).toBe('verbose')
    expect(browserConsoleLevel('log')).toBe('info')
  })

  it('filters messages by text and level with newest results first', () => {
    expect(filterConsoleMessages(messages, 'network', 'all').map((message) => message.message)).toEqual([
      'Request failed',
      'Slow request'
    ])
    expect(filterConsoleMessages(messages, '', 'verbose').map((message) => message.message)).toEqual(['Cache details'])
    expect(filterConsoleMessages(messages, 'loadprofile', 'all').map((message) => message.message)).toEqual(['Request failed'])
  })

  it('counts normalized levels', () => {
    expect(countConsoleMessages(messages)).toEqual({ error: 1, warning: 1, info: 1, verbose: 1 })
  })

  it('counts grouped repetitions as Console events', () => {
    const grouped = messages.map((message, index) => index === 1
      ? { ...message, repeatCount: 4 }
      : { ...message })

    expect(countConsoleEvents(grouped)).toBe(7)
    expect(countConsoleMessages(grouped)).toEqual({ error: 1, warning: 4, info: 1, verbose: 1 })
  })

  it('groups only adjacent-equivalent ordinary Console messages', () => {
    const first: BrowserConsoleMessage = {
      timestamp: '2026-08-15T10:00:00.000Z',
      level: 'warning',
      message: 'retrying request',
      lineNumber: 8,
      sourceId: 'network.js',
      kind: 'console'
    }
    const second = { ...first, timestamp: '2026-08-15T10:00:01.000Z' }
    const grouped = mergeRepeatedConsoleMessage(first, second)

    expect(grouped).toMatchObject({
      timestamp: second.timestamp,
      firstTimestamp: first.timestamp,
      repeatCount: 2
    })
    expect(mergeRepeatedConsoleMessage(grouped, { ...second, timestamp: '2026-08-15T10:00:02.000Z' }))
      .toMatchObject({ repeatCount: 3, firstTimestamp: first.timestamp })
    expect(mergeRepeatedConsoleMessage(first, { ...second, message: 'different' })).toBeUndefined()
  })

  it('groups repeated warning stacks only when every frame matches', () => {
    const first: BrowserConsoleMessage = {
      timestamp: '2026-08-15T10:00:00.000Z',
      level: 'warning',
      message: 'retrying request',
      lineNumber: 8,
      columnNumber: 4,
      sourceId: 'network.js',
      kind: 'console',
      stack: [{ functionName: 'retry', url: 'network.js', lineNumber: 8, columnNumber: 4 }]
    }
    expect(mergeRepeatedConsoleMessage(first, { ...first, timestamp: '2026-08-15T10:00:01.000Z' }))
      .toMatchObject({ repeatCount: 2, stack: first.stack })
    expect(mergeRepeatedConsoleMessage(first, {
      ...first,
      timestamp: '2026-08-15T10:00:01.000Z',
      stack: [{ functionName: 'other', url: 'network.js', lineNumber: 8, columnNumber: 4 }]
    })).toBeUndefined()
  })

  it('never groups uncaught errors or structured exceptions', () => {
    const consoleError: BrowserConsoleMessage = {
      timestamp: '2026-08-15T10:00:00.000Z',
      level: 'error',
      message: 'Uncaught TypeError: broken',
      lineNumber: 3,
      sourceId: 'app.js',
      kind: 'console'
    }
    expect(mergeRepeatedConsoleMessage(consoleError, { ...consoleError, timestamp: '2026-08-15T10:00:00.010Z' }))
      .toBeUndefined()
    expect(mergeRepeatedConsoleMessage(
      { ...consoleError, message: 'TypeError: broken', kind: 'exception' },
      { ...consoleError, message: 'TypeError: broken', kind: 'exception' }
    )).toBeUndefined()
  })
})

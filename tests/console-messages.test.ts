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
  it('matches every inclusion word across one message, source and stack', () => {
    expect(filterConsoleMessages(messages, '  FAILED\tNETWORK.JS\nloadprofile app.js ', 'all')).toEqual([messages[3]])
    expect(filterConsoleMessages(messages, 'app.js request', 'all')).toEqual([messages[3]])
    expect(filterConsoleMessages(messages, 'request request network', 'all')).toEqual([messages[3], messages[1]])
  })

  it('does not combine words from separate messages or search hidden metadata', () => {
    expect(filterConsoleMessages(messages, 'cache request', 'all')).toEqual([])
    expect(filterConsoleMessages(messages, 'request 2026-08-15', 'all')).toEqual([])
    expect(filterConsoleMessages(messages, 'request error', 'all')).toEqual([])
    expect(filterConsoleMessages(messages, 'request 18', 'all')).toEqual([])
  })

  it('combines word search with severity and literal whole-string exclusion', () => {
    expect(filterConsoleMessages(messages, 'request network', 'warning')).toEqual([messages[1]])
    expect(filterConsoleMessages(messages, 'request network', 'all', 'request failed')).toEqual([messages[1]])
    expect(filterConsoleMessages(messages, 'request network', 'all', 'request network')).toEqual([messages[3], messages[1]])
    expect(filterConsoleMessages(messages, 'request network', 'all', 'loadprofile')).toEqual([messages[1]])
  })

  it('keeps empty searches, punctuation, retained objects and newest-first ordering', () => {
    const retained = messages.map(message => ({ ...message, repeatCount: 3 }))
    const before = structuredClone(retained)
    expect(filterConsoleMessages(retained, '\t \n', 'all')).toEqual([...retained].reverse())
    expect(filterConsoleMessages(retained, 'request .*', 'all')).toEqual([])
    expect(filterConsoleMessages(retained, 'request network', 'all')).toEqual([retained[3], retained[1]])
    expect(filterConsoleMessages(retained, 'request network', 'all')[0]).toBe(retained[3])
    expect(retained).toEqual(before)
  })

  it('excludes a literal substring across message, source and stack while preserving inclusion and level filters', () => {
    expect(filterConsoleMessages(messages, '', 'all', ' NETWORK ')).toEqual([messages[2], messages[0]])
    expect(filterConsoleMessages(messages, 'request', 'all', 'loadprofile')).toEqual([messages[1]])
    expect(filterConsoleMessages(messages, '', 'error', 'APP.JS')).toEqual([])
    expect(filterConsoleMessages(messages, '', 'all', '   ')).toEqual([...messages].reverse())
    expect(filterConsoleMessages(messages, '', 'all', '.*')).toEqual([...messages].reverse())
    expect(messages).toHaveLength(4)
  })

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

import { describe, expect, it } from 'vitest'
import {
  MAX_CONSOLE_STACK_FRAMES,
  normalizeConsoleLogEntry,
  normalizeConsoleStack,
  normalizePageException,
  normalizeRuntimeConsoleCall,
  normalizeRuntimeException
} from '../src/shared/console-exceptions.js'

describe('runtime exception normalization', () => {
  it('returns a sanitized structured call stack with 1-based source positions', () => {
    const result = normalizeRuntimeException({
      timestamp: Date.parse('2026-08-15T12:00:00.000Z'),
      exceptionDetails: {
        exceptionId: 42,
        text: 'Uncaught',
        lineNumber: 9,
        columnNumber: 4,
        url: 'https://example.test/app.js?token=source-secret&view=kept#fragment',
        exception: { description: 'TypeError: failed token=message-secret\n    at inner' },
        stackTrace: {
          callFrames: [{
            functionName: 'inner token=function-secret',
            url: 'https://example.test/app.js?token=frame-secret&view=kept#fragment',
            lineNumber: 9,
            columnNumber: 4
          }],
          parent: {
            callFrames: [{ functionName: 'scheduled', url: 'https://example.test/entry.js', lineNumber: 2, columnNumber: 1 }]
          }
        }
      }
    })

    expect(result).toMatchObject({
      timestamp: '2026-08-15T12:00:00.000Z',
      level: 'error',
      message: 'Uncaught: TypeError: failed token=[REDACTED]',
      lineNumber: 10,
      columnNumber: 5,
      sourceId: 'https://example.test/app.js?view=kept&token=%5BREDACTED%5D',
      kind: 'exception',
      exceptionId: 42,
      stack: [
        expect.objectContaining({ functionName: 'inner token=[REDACTED]', lineNumber: 10, columnNumber: 5 }),
        expect.objectContaining({ functionName: 'scheduled', async: true, lineNumber: 3, columnNumber: 2 })
      ]
    })
    expect(JSON.stringify(result)).not.toContain('source-secret')
    expect(JSON.stringify(result)).not.toContain('frame-secret')
    expect(JSON.stringify(result)).not.toContain('function-secret')
    expect(JSON.stringify(result)).not.toContain('fragment')
  })

  it('omits inline sources and caps deeply nested stacks', () => {
    const stack = {
      callFrames: Array.from({ length: MAX_CONSOLE_STACK_FRAMES + 5 }, (_, index) => ({
        functionName: `frame${index}`,
        url: index === 0 ? 'data:text/javascript,private' : 'https://example.test/app.js',
        lineNumber: index,
        columnNumber: 0
      }))
    }
    const result = normalizeConsoleStack(stack)
    expect(result.frames).toHaveLength(MAX_CONSOLE_STACK_FRAMES)
    expect(result.truncated).toBe(true)
    expect(result.frames[0]?.url).toBeUndefined()
  })

  it('omits Electron and Node bridge frames from page call stacks', () => {
    expect(normalizeConsoleStack({
      callFrames: [
        { functionName: 'pageHandler', url: 'https://example.test/app.js', lineNumber: 2, columnNumber: 1 },
        { functionName: 'onMessage', url: 'node:electron/js2c/sandbox_bundle', lineNumber: 1, columnNumber: 2 },
        { functionName: 'bridge', url: 'electron:renderer/init', lineNumber: 3, columnNumber: 4 }
      ]
    }).frames).toEqual([
      expect.objectContaining({ functionName: 'pageHandler', url: 'https://example.test/app.js' })
    ])
  })

  it('normalizes stack-bearing Chromium log entries for Electron fallback capture', () => {
    expect(normalizeConsoleLogEntry({
      source: 'javascript',
      level: 'error',
      text: 'Uncaught TypeError: failed token=private',
      timestamp: Date.parse('2026-08-15T12:01:00.000Z'),
      url: 'https://example.test/app.js?token=private&view=kept',
      lineNumber: 10,
      stackTrace: {
        callFrames: [{ functionName: 'explode', url: 'https://example.test/app.js', lineNumber: 9, columnNumber: 4 }]
      }
    })).toMatchObject({
      timestamp: '2026-08-15T12:01:00.000Z',
      level: 'error',
      message: 'Uncaught TypeError: failed token=[REDACTED]',
      sourceId: 'https://example.test/app.js?view=kept&token=%5BREDACTED%5D',
      lineNumber: 10,
      columnNumber: 5,
      kind: 'exception',
      stack: [expect.objectContaining({ functionName: 'explode', lineNumber: 10, columnNumber: 5 })]
    })
  })

  it('normalizes and sanitizes stack-bearing warning Console calls', () => {
    const result = normalizeRuntimeConsoleCall({
      type: 'warning',
      timestamp: Date.parse('2026-08-15T12:01:30.000Z'),
      args: [
        { type: 'string', value: 'Retry token=message-secret' },
        { type: 'number', value: 3 }
      ],
      stackTrace: {
        callFrames: [{
          functionName: 'warnFromHelper token=function-secret',
          url: 'https://example.test/app.js?token=source-secret&view=kept#fragment',
          lineNumber: 11,
          columnNumber: 2
        }]
      }
    })

    expect(result).toMatchObject({
      timestamp: '2026-08-15T12:01:30.000Z',
      level: 'warning',
      message: 'Retry token=[REDACTED] 3',
      sourceId: 'https://example.test/app.js?view=kept&token=%5BREDACTED%5D',
      lineNumber: 12,
      columnNumber: 3,
      kind: 'console',
      stack: [expect.objectContaining({
        functionName: 'warnFromHelper token=[REDACTED]',
        lineNumber: 12,
        columnNumber: 3
      })]
    })
    expect(JSON.stringify(result)).not.toContain('message-secret')
    expect(JSON.stringify(result)).not.toContain('function-secret')
    expect(JSON.stringify(result)).not.toContain('source-secret')
  })

  it('ignores Console calls that do not carry Chrome error or warning stacks', () => {
    expect(normalizeRuntimeConsoleCall({
      type: 'info',
      args: [{ type: 'string', value: 'ready' }],
      stackTrace: { callFrames: [{ functionName: 'boot', url: 'https://example.test/app.js', lineNumber: 0, columnNumber: 0 }] }
    })).toBeUndefined()
    expect(normalizeRuntimeConsoleCall({ type: 'warning', args: [] })).toBeUndefined()
  })

  it('keeps Chrome severity for trace and failed assertion stacks', () => {
    const stackTrace = {
      callFrames: [{ functionName: 'probe', url: 'https://example.test/app.js', lineNumber: 0, columnNumber: 0 }]
    }
    expect(normalizeRuntimeConsoleCall({
      type: 'trace',
      args: [{ type: 'string', value: 'trace marker' }],
      stackTrace
    })).toMatchObject({ level: 'info', message: 'trace marker', kind: 'console' })
    expect(normalizeRuntimeConsoleCall({
      type: 'assert',
      args: [{ type: 'string', value: 'assert marker' }],
      stackTrace
    })).toMatchObject({ level: 'error', message: 'Assertion failed: assert marker', kind: 'console' })
  })

  it('parses and sanitizes bounded V8 stacks sent by the isolated page preload', () => {
    const result = normalizePageException({
      timestamp: Date.parse('2026-08-15T12:02:00.000Z'),
      message: 'failed token=message-secret',
      sourceId: 'https://example.test/app.js?token=source-secret&view=kept#fragment',
      lineNumber: 12,
      columnNumber: 8,
      stack: [
        'TypeError: failed token=message-secret',
        '    at inner token=function-secret (https://example.test/app.js?token=frame-secret&view=kept#fragment:12:8)',
        '    at async outer (https://example.test/entry.js:4:2)',
        '    at data:text/javascript,private:1:1'
      ].join('\n')
    })
    expect(result).toMatchObject({
      timestamp: '2026-08-15T12:02:00.000Z',
      message: 'Uncaught: failed token=[REDACTED]',
      sourceId: 'https://example.test/app.js?view=kept&token=%5BREDACTED%5D',
      lineNumber: 12,
      columnNumber: 8,
      kind: 'exception',
      stack: [
        expect.objectContaining({ functionName: 'inner token=[REDACTED]', lineNumber: 12, columnNumber: 8 }),
        expect.objectContaining({ functionName: 'outer', async: true, lineNumber: 4, columnNumber: 2 })
      ]
    })
    expect(JSON.stringify(result)).not.toContain('message-secret')
    expect(JSON.stringify(result)).not.toContain('source-secret')
    expect(JSON.stringify(result)).not.toContain('frame-secret')
    expect(JSON.stringify(result)).not.toContain('function-secret')
    expect(JSON.stringify(result)).not.toContain('data:text')
  })
})

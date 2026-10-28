import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { logUncaughtExceptions, UNCAUGHT_EXCEPTION_LOG_PREFIX } from '../src/main/uncaught-exceptions.js'
import { mainUncaughtExceptionReader, type MainUncaughtException } from './integration/main-uncaught-exceptions.js'

// Electron's own handler showed an uncaught exception in a native error box that blocked the main process, which a CI
// run's csp-disposition case hung on until teardown aborted the app.

describe('uncaught exceptions in the main process', () => {
  it('are logged with the error, by a handler of the app\'s own, so Electron shows no error box', () => {
    const source = new EventEmitter()
    const log = vi.fn()
    logUncaughtExceptions(source, log)
    // Electron's handler leaves the box out whenever another handler is listening.
    expect(source.listenerCount('uncaughtException')).toBe(1)
    const error = new Error('broken listener')
    source.emit('uncaughtException', error)
    expect(log).toHaveBeenCalledOnce()
    expect(log).toHaveBeenCalledWith(UNCAUGHT_EXCEPTION_LOG_PREFIX, error)
  })
})

describe('uncaught exceptions in a launch\'s error output', () => {
  const logged = [
    '[main] Uncaught exception: TypeError: Object has been destroyed',
    '    at WebContents.<anonymous> (/workspace/out/main/index.js:10:5)',
    '    at WebContents.emit (node:events:518:28)'
  ]

  function read(chunks: string[]): string[] {
    const exceptions: MainUncaughtException[] = []
    const reader = mainUncaughtExceptionReader(exception => exceptions.push(exception))
    for (const chunk of chunks) reader(chunk)
    return exceptions.map(exception => exception.lines.join('\n'))
  }

  it('keep the logged line and its stack, without the output around them', () => {
    const text = ['[2:1028/203023.345046:ERROR:dbus/bus.cc:406] unrelated', ...logged, '[mcp] Hronaut listening', ''].join('\n')
    expect(read([text])).toEqual([logged.join('\n')])
  })

  it('wait for the rest of a line split between chunks, and keep stack lines that come in a later chunk', () => {
    const text = `${logged.join('\n')}\nafter\n`
    expect(read([text.slice(0, 40), text.slice(40, 90), text.slice(90)])).toEqual([logged.join('\n')])
    expect(read([`${logged[0]}\n`, `${logged[1]}\n`, `${logged[2]}\n`])).toEqual([logged.join('\n')])
  })

  it('leave out the colors Node gives its own frames when Playwright forces them', () => {
    const colored = [logged[0], logged[1], `\u001b[90m${logged[2]}\u001b[39m`, '\u001b[90m    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)\u001b[39m', '']
    expect(read([colored.join('\n')])).toEqual([[...logged, '    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)'].join('\n')])
  })

  it('keep each of several exceptions', () => {
    const second = '[main] Uncaught exception: Error: second'
    expect(read([`${logged.join('\n')}\n${second}\n`])).toEqual([logged.join('\n'), second])
  })

  it('cap a stack that goes on without end', () => {
    const stack = Array.from({ length: 100 }, (_, index) => `    at frame${index} (file.js:1:1)`)
    const [exception] = read([[logged[0], ...stack, ''].join('\n')])
    expect(exception?.split('\n')).toHaveLength(25)
  })

  it('cut a logged line too long to keep short instead of leaving the exception out', () => {
    const long = `[main] Uncaught exception: Error: ${'x'.repeat(10_000)}`
    const [exception, ...rest] = read([long.slice(0, 3000), long.slice(3000, 7000), `${long.slice(7000)}\n${logged[1]}\n`, 'after\n'])
    expect(rest).toEqual([])
    expect(exception?.split('\n')).toEqual([long.slice(0, 4096), logged[1]])
  })

  it('ignore other output', () => {
    expect(read(['Error: not uncaught\n    at somewhere (file.js:1:1)\n', `${'y'.repeat(5000)}\n`])).toEqual([])
  })
})

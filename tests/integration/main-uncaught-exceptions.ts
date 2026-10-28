import type { TestInfo } from '@playwright/test'
import { UNCAUGHT_EXCEPTION_LOG_PREFIX } from '../../src/main/uncaught-exceptions.js'

// The app logs an uncaught exception in its main process and carries on, where Electron's own handler froze it in a
// native error box. Carrying on would let a test pass over the bug, so each launch's error output is read for those
// lines and a test whose launches logged one fails with the error and its stack.

const MAX_EXCEPTIONS = 4
const MAX_STACK_LINES = 24
const STACK_LINE = /^\s+at /

const testExceptions = new WeakMap<TestInfo, string[]>()

/** Starts collecting the uncaught exceptions the test's launches log. */
export function trackMainUncaughtExceptions(testInfo: TestInfo): string[] {
  const exceptions: string[] = []
  testExceptions.set(testInfo, exceptions)
  return exceptions
}

export function untrackMainUncaughtExceptions(testInfo: TestInfo): void {
  testExceptions.delete(testInfo)
}

/** The uncaught exceptions the test's launches logged so far; a test that causes one on purpose takes it out. */
export function mainUncaughtExceptions(testInfo: TestInfo): string[] {
  return testExceptions.get(testInfo) ?? []
}

/** Reads the uncaught exceptions in a launch's error output for the test that launched it. */
export function readMainUncaughtExceptions(testInfo: TestInfo, output: NodeJS.ReadableStream | null | undefined): void {
  const exceptions = testExceptions.get(testInfo)
  if (!exceptions || !output) return
  const read = mainUncaughtExceptionReader((exception) => {
    if (exceptions.length < MAX_EXCEPTIONS) exceptions.push(exception)
  })
  output.on('data', (chunk: Buffer | string) => read(chunk.toString()))
}

/**
 * Reads the main process's uncaught exceptions from output that arrives in chunks: the logged line, then the stack
 * lines that follow it. An exception is passed on once a line that is not part of its stack arrives, or once a chunk
 * ends after its last line, since Node writes the error and its stack at once.
 */
export function mainUncaughtExceptionReader(onException: (exception: string) => void): (chunk: string) => void {
  let partial = ''
  let current: string[] | undefined
  const finish = (): void => {
    if (current) onException(current.join('\n'))
    current = undefined
  }
  const readLine = (line: string): void => {
    if (line.startsWith(UNCAUGHT_EXCEPTION_LOG_PREFIX)) {
      finish()
      current = [line]
      return
    }
    if (!current) return
    if (STACK_LINE.test(line)) {
      if (current.length <= MAX_STACK_LINES) current.push(line)
      return
    }
    finish()
  }
  return (chunk) => {
    const lines = (partial + chunk).split('\n')
    partial = lines.pop() ?? ''
    // A line that never ends is no exception's, and keeping it would grow without bound.
    if (partial.length > 4096) partial = ''
    for (const line of lines) readLine(line.replace(/\r$/, ''))
    if (!partial) finish()
  }
}

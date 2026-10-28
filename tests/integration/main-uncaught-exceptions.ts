import type { TestInfo } from '@playwright/test'
import { UNCAUGHT_EXCEPTION_LOG_PREFIX } from '../../src/main/uncaught-exceptions.js'

// The app logs an uncaught exception in its main process and carries on, where Electron's own handler froze it in a
// native error box. Carrying on would let a test pass over the bug, so each launch's error output is read for those
// lines and a test whose launches logged one fails with the error and its stack.

/** One uncaught exception as the main process logged it: the logged line, then its stack lines. */
export interface MainUncaughtException {
  lines: string[]
}

const MAX_EXCEPTIONS = 4
const MAX_STACK_LINES = 24
const MAX_LINE_LENGTH = 4096
const STACK_LINE = /^\s+at /
// Playwright sets FORCE_COLOR for its workers, which the launch inherits, so Node greys out its own stack frames.
// eslint-disable-next-line no-control-regex
const COLOR = /\u001b\[[\d;]*m/g

const testExceptions = new WeakMap<TestInfo, MainUncaughtException[]>()

/** Starts collecting the uncaught exceptions the test's launches log. */
export function trackMainUncaughtExceptions(testInfo: TestInfo): MainUncaughtException[] {
  const exceptions: MainUncaughtException[] = []
  testExceptions.set(testInfo, exceptions)
  return exceptions
}

export function untrackMainUncaughtExceptions(testInfo: TestInfo): void {
  testExceptions.delete(testInfo)
}

/** The uncaught exceptions the test's launches logged so far; a test that causes one on purpose takes it out. */
export function mainUncaughtExceptions(testInfo: TestInfo): MainUncaughtException[] {
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
 * lines that follow it, without color codes. An exception is passed on as its logged line arrives and fills in as its
 * stack lines do, until a line that is not part of its stack. A line too long to keep is cut short.
 */
export function mainUncaughtExceptionReader(onException: (exception: MainUncaughtException) => void): (chunk: string) => void {
  let partial = ''
  /** Whether the rest of a line cut short is still to come, which is then left out. */
  let skipping = false
  let current: MainUncaughtException | undefined
  const readLine = (raw: string): void => {
    const line = raw.replace(/\r$/, '').replace(COLOR, '')
    if (line.startsWith(UNCAUGHT_EXCEPTION_LOG_PREFIX)) {
      current = { lines: [line] }
      onException(current)
      return
    }
    if (!current) return
    if (!STACK_LINE.test(line)) {
      current = undefined
      return
    }
    if (current.lines.length <= MAX_STACK_LINES) current.lines.push(line)
  }
  return (chunk) => {
    const lines = (partial + chunk).split('\n')
    partial = lines.pop() ?? ''
    for (const line of lines) {
      if (skipping) skipping = false
      else readLine(line)
    }
    if (partial.length > MAX_LINE_LENGTH && !skipping) {
      readLine(partial.slice(0, MAX_LINE_LENGTH))
      skipping = true
    }
    if (skipping) partial = ''
  }
}

import type { TestInfo } from '@playwright/test'

// Each e2e launch has Electron print a native stack trace for every process that crashes, so an unexplained renderer
// crash leaves more than its exit code. A failed test attaches those traces as signal and module+offset frames only:
// nothing else the processes print, and no folder names.

/** One crash as its process printed it: the signal line and the frames, innermost first. */
export interface NativeCrashStack {
  signal: string
  frames: string[]
  /** Set on the SIGABRT trace teardown asked for from a main process that did not quit, which is no crash of its own. */
  requestedByTeardown?: true
}

/** Whether teardown has sent a launch's main process SIGABRT, so the abort trace it prints is marked as asked for. */
export interface TeardownAbort {
  requested: boolean
}

const MAX_STACKS = 8
const MAX_FRAMES = 64
// "11 SEGV_MAPERR 000000000000": the signal number, its code and the faulting address, as Chromium prints them.
const SIGNAL_LINE = /^Received signal (\d+(?: (?:[A-Z_]+|<unknown>))?(?: [0-9a-f]+)?)$/
const FRAME_LINE = /^#(\d+) 0x[0-9a-f]+ \((?:.*\/)?([^/()]+)\+(0x[0-9a-f]+)\)$/

const testStacks = new WeakMap<TestInfo, NativeCrashStack[]>()

/** Starts collecting the crash traces of the test's launches. */
export function trackNativeCrashStacks(testInfo: TestInfo): NativeCrashStack[] {
  const stacks: NativeCrashStack[] = []
  testStacks.set(testInfo, stacks)
  return stacks
}

export function untrackNativeCrashStacks(testInfo: TestInfo): void {
  testStacks.delete(testInfo)
}

/** The crash traces the test's launches printed so far. */
export function nativeCrashStacks(testInfo: TestInfo): readonly NativeCrashStack[] {
  return testStacks.get(testInfo) ?? []
}

/** Whether the test collects crash traces, so its launches should print them. */
export function collectsNativeCrashStacks(testInfo: TestInfo): boolean {
  return testStacks.has(testInfo)
}

/** Reads the crash traces in a launch's error output for the test that launched it. */
export function readNativeCrashStacks(
  testInfo: TestInfo,
  output: NodeJS.ReadableStream | null | undefined,
  teardownAbort: TeardownAbort = { requested: false }
): void {
  const stacks = testStacks.get(testInfo)
  if (!stacks || !output) return
  const read = nativeCrashStackReader((stack) => {
    if (stacks.length >= MAX_STACKS) return
    if (teardownAbort.requested && stack.signal === '6') stack.requestedByTeardown = true
    stacks.push(stack)
  })
  output.on('data', (chunk: Buffer | string) => read(chunk.toString()))
}

/**
 * Reads Chromium's crash traces from output that arrives in chunks: a "Received signal" line, frames such as
 * "#3 0x5636479ae3ee (/opt/app/electron+0x4b873ed)", the registers, then "[end of stack trace]". Each frame keeps only
 * its module's file name and offset. A trace is passed on as it starts and fills in as its frames arrive, so one whose
 * process died while printing it is kept too.
 *
 * Every process of the app writes to the same output, and Chromium prints a trace in pieces, so other output can land
 * between and inside its lines. Those lines are skipped, a signal line they broke reads as "unreadable", and a frame
 * numbered out of order, which belongs to another trace, is left out.
 */
export function nativeCrashStackReader(onStack: (stack: NativeCrashStack) => void): (chunk: string) => void {
  let partial = ''
  let current: { stack: NativeCrashStack; lastFrame: number } | undefined
  const readLine = (line: string): void => {
    if (line.startsWith('Received signal ')) {
      const stack = { signal: SIGNAL_LINE.exec(line)?.[1] ?? 'unreadable', frames: [] }
      current = { stack, lastFrame: -1 }
      onStack(stack)
      return
    }
    if (!current) return
    if (line === '[end of stack trace]') {
      current = undefined
      return
    }
    const frame = FRAME_LINE.exec(line)
    if (!frame) return
    const index = Number(frame[1])
    if (index <= current.lastFrame) return
    current.lastFrame = index
    if (current.stack.frames.length < MAX_FRAMES) current.stack.frames.push(`${frame[2]}+${frame[3]}`)
  }
  return (chunk) => {
    const lines = (partial + chunk).split('\n')
    partial = lines.pop() ?? ''
    // A line that never ends is not a crash trace, and keeping it would grow without bound.
    if (partial.length > 4096) partial = ''
    for (const line of lines) readLine(line.replace(/\r$/, ''))
  }
}

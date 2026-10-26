import type { TestInfo } from '@playwright/test'

// Each e2e launch has Electron print a native stack trace for every process that crashes, so an unexplained renderer
// crash leaves more than its exit code. A failed test attaches those traces as signal and module+offset frames only:
// nothing else the processes print, and no folder names.

/** One crash as its process printed it: the signal line and the frames, innermost first. */
export interface NativeCrashStack {
  signal: string
  frames: string[]
}

const MAX_STACKS = 8
const MAX_FRAMES = 64
const MAX_SIGNAL_TEXT = 80

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
export function readNativeCrashStacks(testInfo: TestInfo, output: NodeJS.ReadableStream | null | undefined): void {
  const stacks = testStacks.get(testInfo)
  if (!stacks || !output) return
  const read = nativeCrashStackReader((stack) => {
    if (stacks.length < MAX_STACKS) stacks.push(stack)
  })
  output.on('data', (chunk: Buffer | string) => read(chunk.toString()))
}

/**
 * Reads Chromium's crash traces from output that arrives in chunks: a "Received signal" line, frames such as
 * "#3 0x5636479ae3ee (/opt/app/electron+0x4b873ed)", then "[end of stack trace]". Each frame keeps only its module's
 * file name and offset. A trace is passed on as it starts and fills in as its frames arrive, so one whose process
 * died while printing it is kept too.
 */
export function nativeCrashStackReader(onStack: (stack: NativeCrashStack) => void): (chunk: string) => void {
  let partial = ''
  let current: NativeCrashStack | undefined
  const readLine = (line: string): void => {
    const signal = /^Received signal (.*)$/.exec(line)
    if (signal) {
      current = { signal: (signal[1] ?? '').slice(0, MAX_SIGNAL_TEXT), frames: [] }
      onStack(current)
      return
    }
    if (!current) return
    const frame = /^#\d+ 0x[0-9a-f]+ \((?:.*\/)?([^/()]+)\+(0x[0-9a-f]+)\)$/.exec(line)
    if (frame) {
      if (current.frames.length < MAX_FRAMES) current.frames.push(`${frame[1]}+${frame[2]}`)
    } else if (!/^#\d+ /.test(line)) {
      // The end of the trace, or another process's output.
      current = undefined
    }
  }
  return (chunk) => {
    const lines = (partial + chunk).split('\n')
    partial = lines.pop() ?? ''
    // A line that never ends is not a crash trace, and keeping it would grow without bound.
    if (partial.length > 4096) partial = ''
    for (const line of lines) readLine(line.replace(/\r$/, ''))
  }
}

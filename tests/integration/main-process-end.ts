import type { ElectronApplication } from '@playwright/test'

// A main process that ended while a test still used it left only "Target page, context or browser has been closed",
// with no crash trace and nothing in the browser logs. A failed test's diagnostics now say how it ended: its exit code
// or signal, how long after launch, and the last lines its processes logged, each reduced to Chromium's level and
// source location or to Hronaut's log tag and plain words, so no address, folder, id or value is kept.

export interface MainProcessEnd {
  exitCode: number | null
  signal: string | null
  /** Milliseconds from when the launch returned to the exit, or null while it runs. */
  ranForMs: number | null
  /**
   * The last lines logged, oldest first, such as "ERROR dbus/bus.cc:406" or "[browser] Could not put tab # to sleep",
   * with a line repeated in a row counted once, as "ERROR dbus/bus.cc:406 (4 times)".
   */
  lastLogLines: string[]
}

const MAX_LINES = 16
const MAX_TEXT = 80
// A line that never ends would grow without bound; its start is read and the rest left out.
const MAX_LINE = 4096
// "[3779:1029/030605.268817:ERROR:dbus/bus.cc:406] Failed to connect …": the process, time, level and source location.
const CHROMIUM_LINE = /^\[[\d:/.]+:(INFO|WARNING|ERROR|FATAL|VERBOSE\d*):([^\]\s]+)\]/
// "[startup] Could not open the workspace recovery window; …": Hronaut's tag, then words up to an address, path or detail.
const HRONAUT_LINE = /^\[([a-z][a-z-]*)\] ([A-Za-z][A-Za-z0-9 ,;.'-]*)/
// A word with a digit, such as an id, a count or a port, or with a dot inside it, such as a host or a file name.
const VALUE_WORD = /\d|\.[A-Za-z0-9]/

interface Launch {
  // Playwright's process() throws once the process has exited, so the launch keeps its child.
  child: ReturnType<ElectronApplication['process']>
  launchedAt: number
  exitedAt: number | null
  lines: Array<{ summary: string; times: number }>
}

const launches = new WeakMap<ElectronApplication, Launch>()

/** A logged line as the diagnostics keep it, or undefined for a line they leave out. */
export function logLineSummary(line: string): string | undefined {
  const chromium = CHROMIUM_LINE.exec(line)
  if (chromium) return `${chromium[1]} ${chromium[2]}`
  const hronaut = HRONAUT_LINE.exec(line)
  if (!hronaut) return undefined
  const text = hronaut[2]!.slice(0, MAX_TEXT)
  const words = text.split(' ')
  // A last word that runs on into what is not kept, as "alice" in "alice@example.com" or a word cut short, is left out;
  // one before a colon is a plain word, as "sleep" in "to sleep: renderer gone".
  const next = line.charAt(hronaut[0].length - hronaut[2]!.length + text.length)
  if (next !== '' && next !== ':' && !/\s/.test(next)) words.pop()
  return `[${hronaut[1]}] ${words.map(word => (VALUE_WORD.test(word) ? '#' : word)).join(' ')}`.trimEnd()
}

/** Reads output that arrives in chunks, line by line, and passes on each line's summary. */
export function logLineReader(onLine: (summary: string) => void): (chunk: string) => void {
  let partial = ''
  // Past a line too long to keep, the rest of it is left out up to its end, so none of it reads as a line of its own.
  let skipping = false
  const read = (line: string): void => {
    const summary = logLineSummary(line.replace(/\r$/, ''))
    if (summary !== undefined) onLine(summary)
  }
  return (chunk) => {
    let text = partial + chunk
    partial = ''
    if (skipping) {
      const end = text.indexOf('\n')
      if (end === -1) return
      text = text.slice(end + 1)
      skipping = false
    }
    const lines = text.split('\n')
    const last = lines.pop() ?? ''
    for (const line of lines) read(line)
    if (last.length <= MAX_LINE) {
      partial = last
      return
    }
    read(last.slice(0, MAX_LINE))
    skipping = true
  }
}

/** Starts keeping how a launch's main process ends and the last lines its processes log. */
export function trackMainProcessEnd(app: ElectronApplication): void {
  const child = app.process()
  const launch: Launch = { child, launchedAt: Date.now(), exitedAt: null, lines: [] }
  launches.set(app, launch)
  child.once('exit', () => { launch.exitedAt = Date.now() })
  const read = (): ((chunk: Buffer | string) => void) => {
    const reader = logLineReader((summary) => {
      const last = launch.lines.at(-1)
      if (last?.summary === summary) {
        last.times += 1
        return
      }
      launch.lines.push({ summary, times: 1 })
      if (launch.lines.length > MAX_LINES) launch.lines.shift()
    })
    return (chunk) => reader(chunk.toString())
  }
  child.stderr?.on('data', read())
  child.stdout?.on('data', read())
}

/**
 * Waits up to waitMs for a tracked launch's main process to exit, as it does just after its connection to the test
 * closes, and returns at once for a process that exited or a launch not tracked.
 */
export async function mainProcessExit(app: ElectronApplication, waitMs: number): Promise<void> {
  const launch = launches.get(app)
  if (!launch || launch.exitedAt !== null) return
  const { child } = launch
  await new Promise<void>((resolve) => {
    const exited = (): void => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      child.off('exit', exited)
      resolve()
    }, waitMs)
    child.once('exit', exited)
  })
}

/** How a tracked launch's main process ended, or is still running, or undefined for a launch not tracked. */
export function mainProcessEnd(app: ElectronApplication): MainProcessEnd | undefined {
  const launch = launches.get(app)
  if (!launch) return undefined
  return {
    exitCode: launch.child.exitCode,
    signal: launch.child.signalCode,
    ranForMs: launch.exitedAt === null ? null : launch.exitedAt - launch.launchedAt,
    lastLogLines: launch.lines.map(({ summary, times }) => (times === 1 ? summary : `${summary} (${times} times)`))
  }
}

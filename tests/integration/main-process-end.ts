import type { ElectronApplication } from '@playwright/test'

// A main process that ended while a test still used it left only "Target page, context or browser has been closed",
// with no crash trace and nothing in the browser logs. A failed test's diagnostics now say how it ended: its exit code
// or signal, how long after launch, and the last lines its processes logged, each reduced to Chromium's level and
// source location or to Hronaut's log tag and the words before any detail, so no address, folder or value is kept.

export interface MainProcessEnd {
  exitCode: number | null
  signal: string | null
  /** Milliseconds from launch to exit, or null while it runs. */
  ranForMs: number | null
  /**
   * The last lines logged, oldest first, such as "ERROR dbus/bus.cc:406" or "[startup] Could not open the window", with
   * a line repeated in a row counted once, as "ERROR dbus/bus.cc:406 (4 times)".
   */
  lastLogLines: string[]
}

const MAX_LINES = 16
const MAX_WORDS = 80
// "[3779:1029/030605.268817:ERROR:dbus/bus.cc:406] Failed to connect …": the process, time, level and source location.
const CHROMIUM_LINE = /^\[[\d:/.]+:(INFO|WARNING|ERROR|FATAL|VERBOSE\d*):([^\]\s]+)\]/
// "[startup] Could not open the workspace recovery window; …": Hronaut's tag, then words up to an address, path or detail.
const HRONAUT_LINE = /^\[([a-z][a-z-]*)\] ([A-Za-z][A-Za-z0-9 ,;.'-]*)/

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
  if (hronaut) return `[${hronaut[1]}] ${hronaut[2]!.slice(0, MAX_WORDS).trim()}`
  return undefined
}

/** Reads output that arrives in chunks, line by line, and passes on each line's summary. */
export function logLineReader(onLine: (summary: string) => void): (chunk: string) => void {
  let partial = ''
  return (chunk) => {
    const lines = (partial + chunk).split('\n')
    partial = lines.pop() ?? ''
    // A line that never ends would grow without bound.
    if (partial.length > 4096) partial = ''
    for (const line of lines) {
      const summary = logLineSummary(line.replace(/\r$/, ''))
      if (summary !== undefined) onLine(summary)
    }
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

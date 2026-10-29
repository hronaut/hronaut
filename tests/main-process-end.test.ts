import { EventEmitter } from 'node:events'
import type { ElectronApplication } from '@playwright/test'
import { describe, expect, it } from 'vitest'
import { logLineReader, logLineSummary, mainProcessEnd, trackMainProcessEnd } from './integration/main-process-end.js'

// A main process that ended mid-test left only "Target page, context or browser has been closed": no exit code, no
// signal and none of what it logged.

function read(chunks: string[]): string[] {
  const lines: string[] = []
  const reader = logLineReader(line => lines.push(line))
  for (const chunk of chunks) reader(chunk)
  return lines
}

function launched() {
  const stderr = new EventEmitter()
  const stdout = new EventEmitter()
  const child = Object.assign(new EventEmitter(), { exitCode: null as number | null, signalCode: null as string | null, stderr, stdout })
  let exited = false
  child.once('exit', () => { exited = true })
  // Playwright's process() throws once the process has exited.
  const app = { process: () => { if (exited) throw new TypeError('Cannot read properties of undefined'); return child } } as unknown as ElectronApplication
  trackMainProcessEnd(app)
  return { app, child, stderr, stdout }
}

describe('how a launch\'s main process ended', () => {
  it('keeps Chromium\'s level and source location, and Hronaut\'s tag and words before an address, path or detail', () => {
    expect(logLineSummary('[3779:1029/030605.268817:ERROR:dbus/bus.cc:406] Failed to connect to socket /run/dbus/system_bus_socket'))
      .toBe('ERROR dbus/bus.cc:406')
    expect(logLineSummary('[1026/005221.866410:FATAL:gpu_init.cc] unrelated')).toBe('FATAL gpu_init.cc')
    expect(logLineSummary('[mcp] Hronaut listening at http://127.0.0.1:15001/mcp')).toBe('[mcp] Hronaut listening at http')
    expect(logLineSummary('[browser] Failed to persist tabs /tmp/hronaut-integration-abc/tabs.json')).toBe('[browser] Failed to persist tabs')
    expect(logLineSummary('[shutdown] Runtime cleanup exceeded 10 seconds; exiting so update relaunch can continue.'))
      .toBe('[shutdown] Runtime cleanup exceeded 10 seconds; exiting so update relaunch can continue.')
    expect(logLineSummary(`[startup] ${'word '.repeat(40)}`)).toHaveLength('[startup] '.length + 79)
    // Other output, such as the DevTools address or a page's text, is left out.
    for (const line of ['DevTools listening on ws://127.0.0.1:46773/devtools/browser/x', 'Debugger attached.', 'secret value', '[Page] title']) {
      expect(logLineSummary(line)).toBeUndefined()
    }
  })

  it('reads lines from chunks split anywhere', () => {
    const text = '[3779:1029/030605.268817:ERROR:dbus/bus.cc:406] x\nnoise\n[startup] Starting the browser\n'
    const expected = ['ERROR dbus/bus.cc:406', '[startup] Starting the browser']
    expect(read([text])).toEqual(expected)
    expect(read(text.match(/[\s\S]{1,5}/g)!)).toEqual(expected)
    expect(read([text.replaceAll('\n', '\r\n')])).toEqual(expected)
    expect(read(['[startup] unfinished'])).toEqual([])
  })

  it('says how it exited, how long after launch, and the last 16 lines its processes logged, each repeat counted once', () => {
    const { app, child, stderr, stdout } = launched()
    expect(mainProcessEnd(app)).toEqual({ exitCode: null, signal: null, ranForMs: null, lastLogLines: [] })
    for (let index = 0; index < 20; index++) stderr.emit('data', Buffer.from(`[3779:1029/030605.268817:ERROR:dbus/bus.cc:${index}] x\n`))
    stdout.emit('data', '[mcp] Hronaut listening at http://127.0.0.1:15001/mcp\n')
    stderr.emit('data', '[3779:1029/030605.268817:ERROR:dbus/bus.cc:406] x\n'.repeat(3))
    child.signalCode = 'SIGKILL'
    child.emit('exit', null, 'SIGKILL')
    const ended = mainProcessEnd(app)!
    expect(ended).toMatchObject({ exitCode: null, signal: 'SIGKILL' })
    expect(ended.ranForMs).toBeGreaterThanOrEqual(0)
    expect(ended.lastLogLines).toHaveLength(16)
    expect(ended.lastLogLines[0]).toBe('ERROR dbus/bus.cc:6')
    expect(ended.lastLogLines.slice(-2)).toEqual(['[mcp] Hronaut listening at http', 'ERROR dbus/bus.cc:406 (3 times)'])
  })

  it('knows nothing of a launch it did not track', () => {
    expect(mainProcessEnd({ process: () => { throw new Error('not launched') } } as unknown as ElectronApplication)).toBeUndefined()
  })
})

import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startWorkerDisplay } from './integration/worker-display.js'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))

function displayProcess() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn((_signal: string) => {
      queueMicrotask(() => child.emit('exit', null, _signal))
      return true
    })
  })
  vi.mocked(spawn).mockReturnValueOnce(child as unknown as ReturnType<typeof spawn>)
  return child
}

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

describe('isolated worker displays', () => {
  it('waits for Xvfb readiness and accepts independent allocated display numbers', async () => {
    const first = displayProcess()
    const second = displayProcess()
    const startingFirst = startWorkerDisplay()
    const startingSecond = startWorkerDisplay()
    first.stdout.write('10')
    first.stdout.write('1\n')
    second.stdout.write('102\n')
    const desktops = await Promise.all([startingFirst, startingSecond])
    try {
      expect(desktops.map(desktop => desktop.display)).toEqual([':101', ':102'])
    } finally { await Promise.all(desktops.map(desktop => desktop.close())) }
    expect(first.kill).toHaveBeenCalledOnce()
    expect(second.kill).toHaveBeenCalledOnce()
  })

  it('kills an unresponsive server and makes repeated cleanup harmless', async () => {
    vi.useFakeTimers()
    const child = displayProcess()
    child.kill.mockImplementation(signal => {
      if (signal === 'SIGKILL') child.emit('exit', null, signal)
      return true
    })
    const starting = startWorkerDisplay()
    child.stdout.write('104\n')
    const desktop = await starting
    const closing = desktop.close()
    await vi.advanceTimersByTimeAsync(2_000)
    await closing
    await desktop.close()
    expect(child.kill.mock.calls.map(([signal]) => signal)).toEqual(['SIGTERM', 'SIGKILL'])
  })

  it('reports a missing Xvfb executable without leaking exit handlers', async () => {
    const originalListeners = process.listenerCount('exit')
    const child = displayProcess()
    const starting = startWorkerDisplay()
    child.emit('error', new Error('spawn Xvfb ENOENT'))
    await expect(starting).rejects.toThrow('spawn Xvfb ENOENT')
    expect(process.listenerCount('exit')).toBe(originalListeners)
  })

  it('includes server diagnostics when startup exits early', async () => {
    const child = displayProcess()
    const starting = startWorkerDisplay()
    child.stderr.write('Cannot establish any listening sockets')
    child.emit('exit', 1)
    await expect(starting).rejects.toThrow('Cannot establish any listening sockets')
  })

  it('bounds startup and cleans up a server that never becomes ready', async () => {
    vi.useFakeTimers()
    const child = displayProcess()
    const failed = expect(startWorkerDisplay()).rejects.toThrow('Xvfb did not become ready')
    await vi.advanceTimersByTimeAsync(10_000)
    await failed
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  })
})

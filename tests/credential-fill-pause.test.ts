import { describe, expect, it, vi } from 'vitest'
import { fillCredentialWhileMcpPaused } from '../src/main/credentials/credential-fill-pause.js'
import { McpPauseState } from '../src/main/mcp-runtime/mcp-pause-state.js'

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('fillCredentialWhileMcpPaused', () => {
  it('keeps MCP paused when the user resumes while credential filling is still active', async () => {
    const pauseState = new McpPauseState()
    const fillHeld = deferred<boolean>()
    let fillStarted = false

    const fill = fillCredentialWhileMcpPaused({
      pausePersistently: () => pauseState.setPersistent(true),
      acquireTemporaryPause: () => pauseState.acquireTemporary(),
      getActiveRequestCount: () => 0,
      fill: async () => {
        fillStarted = true
        return fillHeld.promise
      }
    })

    await Promise.resolve()
    expect(fillStarted).toBe(true)
    pauseState.setPersistent(false)
    expect(pauseState.paused).toBe(true)

    fillHeld.resolve(true)
    await expect(fill).resolves.toBe(true)
    expect(pauseState.paused).toBe(false)
  })

  it('releases the temporary pause after a failed fill without clearing the persistent pause', async () => {
    const pauseState = new McpPauseState()

    await expect(fillCredentialWhileMcpPaused({
      pausePersistently: () => pauseState.setPersistent(true),
      acquireTemporaryPause: () => pauseState.acquireTemporary(),
      getActiveRequestCount: () => 0,
      fill: async () => { throw new Error('fill failed') }
    })).rejects.toThrow('fill failed')

    expect(pauseState.paused).toBe(true)
  })

  it('stops waiting for running agent commands after five seconds, whatever the wall clock does', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout'] })
    try {
      const fill = vi.fn(async () => true)
      const filling = fillCredentialWhileMcpPaused({
        pausePersistently: () => undefined,
        acquireTemporaryPause: () => () => undefined,
        getActiveRequestCount: () => 1,
        fill
      })
      const settled = filling.then(() => 'filled', () => 'refused')
      vi.setSystemTime(Date.now() - 3_600_000)
      await vi.advanceTimersByTimeAsync(5_025)
      await expect(Promise.race([settled, Promise.resolve('waiting')])).resolves.toBe('refused')
      expect(fill).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps waiting for running agent commands for five seconds when the wall clock steps forward', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout'] })
    try {
      let running = 1
      const fill = vi.fn(async () => true)
      const filling = fillCredentialWhileMcpPaused({
        pausePersistently: () => undefined,
        acquireTemporaryPause: () => () => undefined,
        getActiveRequestCount: () => running,
        fill
      })
      const settled = filling.then(() => 'filled', () => 'refused')
      vi.setSystemTime(Date.now() + 3_600_000)
      await vi.advanceTimersByTimeAsync(4_000)
      await expect(Promise.race([settled, Promise.resolve('waiting')])).resolves.toBe('waiting')
      running = 0
      await vi.advanceTimersByTimeAsync(100)
      await expect(settled).resolves.toBe('filled')
      expect(fill).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })
})

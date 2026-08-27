import { describe, expect, it } from 'vitest'
import { fillCredentialWhileMcpPaused } from '../src/main/credential-fill-pause.js'
import { McpPauseState } from '../src/main/mcp-pause-state.js'

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
})

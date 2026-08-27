import { describe, expect, it } from 'vitest'
import { McpPauseState } from '../src/main/mcp-pause-state.js'

describe('McpPauseState', () => {
  it('keeps an effective pause while a temporary lease is active', () => {
    const state = new McpPauseState()
    const release = state.acquireTemporary()

    state.setPersistent(false)
    expect(state.paused).toBe(true)

    release()
    expect(state.paused).toBe(false)
  })

  it('preserves a persistent pause established during a temporary lease', () => {
    const state = new McpPauseState()
    const release = state.acquireTemporary()

    state.setPersistent(true)
    release()

    expect(state.paused).toBe(true)
  })

  it('requires every temporary lease to release and makes releases idempotent', () => {
    const state = new McpPauseState()
    const releaseFirst = state.acquireTemporary()
    const releaseSecond = state.acquireTemporary()

    releaseFirst()
    releaseFirst()
    expect(state.paused).toBe(true)

    releaseSecond()
    expect(state.paused).toBe(false)
  })
})

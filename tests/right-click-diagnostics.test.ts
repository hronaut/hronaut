import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installRightClickGate, rightClickSettlement, type RightClickScope } from './integration/right-click-diagnostics.js'

function setup(send = vi.fn(async (_method: string, ..._args: unknown[]): Promise<unknown> => ({ privateResult: 'secret' }))) {
  const debuggerApi = Object.assign(new EventEmitter(), { sendCommand: send })
  const page = { getURL: () => 'fixture', isDestroyed: () => false, debugger: debuggerApi }
  installRightClickGate({ webContents: { getAllWebContents: () => [page] } } as unknown as typeof import('electron'), { url: 'fixture', cleanup: false })
  return { debuggerApi, send, gate: (globalThis as RightClickScope).rightClickGate! }
}

afterEach(() => {
  (globalThis as RightClickScope).rightClickGate?.restore()
  delete (globalThis as RightClickScope).rightClickGate
})

describe('right-click diagnostics (observation only)', () => {
  it('distinguishes an invoked pending command from acknowledged held viewport work', async () => {
    let complete!: (value: unknown) => void
    const result = { privateResult: 'secret' }
    const native = new Promise(resolve => { complete = resolve })
    const { debuggerApi, send, gate } = setup(vi.fn(() => native))
    const pending = debuggerApi.sendCommand('Page.getLayoutMetrics', { privateParameter: 'secret' })
    expect(send).toHaveBeenCalledExactlyOnceWith('Page.getLayoutMetrics', { privateParameter: 'secret' })
    expect(gate.held).toBe(false)
    expect(gate.events.map(({ stage }) => stage)).toEqual(['invoke'])
    complete(result)
    await Promise.resolve()
    expect(gate.held).toBe(true)
    expect(gate.events.map(({ stage }) => stage)).toEqual(['invoke', 'resolve', 'gate-held'])
    expect(gate.events.map(({ command }) => command)).toEqual([1, 1, 1])
    let settled = false
    void pending.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    gate.release()
    expect(await pending).toBe(result)
    expect(JSON.stringify(gate.events)).not.toContain('secret')
  })

  it('preserves the exact rejection and records that the viewport was never held', async () => {
    const error = new Error('private error secret')
    const { debuggerApi, gate } = setup(vi.fn(async () => { throw error }))
    await expect(debuggerApi.sendCommand('Page.getLayoutMetrics')).rejects.toBe(error)
    expect(gate.held).toBe(false)
    expect(gate.events.map(({ stage }) => stage)).toEqual(['invoke', 'reject'])
    expect(JSON.stringify(gate.events)).not.toContain('secret')
  })

  it('bounds records and maps unknown methods without retaining their names', async () => {
    const { debuggerApi, gate } = setup()
    for (let index = 0; index < 70; index++) await debuggerApi.sendCommand('private-secret-method')
    expect(gate.events).toHaveLength(128)
    expect(gate.dropped).toBe(12)
    expect(gate.events.every(event => event.method === 'other')).toBe(true)
    expect(JSON.stringify(gate.events)).not.toContain('secret')
  })

  it('restores the original command method and removes only its own listener', () => {
    const { debuggerApi, send, gate } = setup()
    const other = vi.fn()
    debuggerApi.on('message', other)
    debuggerApi.emit('message', {}, 'Page.frameResized', { secret: 'page data' })
    expect(gate.events).toMatchObject([{ stage: 'notification', method: 'Page.frameResized' }])
    gate.restore()
    expect(debuggerApi.sendCommand).toBe(send)
    expect(debuggerApi.listeners('message')).toEqual([other])
  })

  it('retains fixed outcome categories without result text or arbitrary structured data', () => {
    const result = rightClickSettlement({ isError: true, content: [{ type: 'text', text: 'private secret' }],
      structuredContent: { status: 'OUTCOME_UNKNOWN', reason: 'CONTEXT_OR_INPUT_UNCERTAIN', secret: 'private' } })
    expect(result).toMatchObject({ state: 'fulfilled', isError: true, status: 'OUTCOME_UNKNOWN', reason: 'CONTEXT_OR_INPUT_UNCERTAIN' })
    expect(JSON.stringify(result)).not.toContain('private')
    expect(rightClickSettlement({ isError: true, content: [], structuredContent: { status: 'NOT_DISPATCHED' } }))
      .toMatchObject({ state: 'fulfilled', isError: true, status: 'NOT_DISPATCHED' })
    expect(rightClickSettlement({ content: [], structuredContent: { status: 'private', reason: 'private' } }))
      .toEqual({ at: expect.any(Number), state: 'fulfilled', isError: false })
  })
})

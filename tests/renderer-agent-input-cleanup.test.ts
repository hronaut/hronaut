import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { clearRendererAgentInputFlag } from '../src/main/browser/native-input-cleanup.js'

function fixture() {
  const events = new EventEmitter()
  let destroyed = false
  let resolve!: (value: unknown) => void
  let reject!: (error: Error) => void
  const evaluation = new Promise<unknown>((yes, no) => { resolve = yes; reject = no })
  const page = Object.assign(events, {
    isDestroyed: vi.fn(() => destroyed),
    executeJavaScript: vi.fn(() => evaluation)
  })
  const destroy = () => { destroyed = true; events.emit('destroyed') }
  return { page, destroy, resolve, reject }
}

describe('renderer agent-input flag cleanup', () => {
  it.each(['false', 'reject', 'throw'] as const)('reports %s to an opted-in cleanup owner', async mode => {
    const f = fixture(), onFailure = vi.fn()
    if (mode === 'throw') f.page.executeJavaScript.mockImplementation(() => { throw new Error('Unavailable') })
    const pending = clearRendererAgentInputFlag(f.page, onFailure)
    if (mode === 'false') f.resolve(false)
    if (mode === 'reject') f.reject(new Error('Unavailable'))
    await pending
    expect(onFailure).toHaveBeenCalledTimes(1)
    expect(f.page.listenerCount('destroyed')).toBe(0)
  })
  it('waits for live-document cleanup and removes the destruction listener', async () => {
    const f = fixture()
    let settled = false
    const pending = clearRendererAgentInputFlag(f.page).then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(f.page.listenerCount('destroyed')).toBe(1)
    expect(f.page.executeJavaScript).toHaveBeenCalledExactlyOnceWith('delete window.__hronautAgentInputActive', true)
    f.resolve(true)
    await pending
    expect(f.page.listenerCount('destroyed')).toBe(0)
  })

  it('settles after destruction while the real evaluation remains pending', async () => {
    const f = fixture()
    const pending = clearRendererAgentInputFlag(f.page)
    f.destroy()
    await pending
    expect(f.page.executeJavaScript).toHaveBeenCalledTimes(1)
    expect(f.page.listenerCount('destroyed')).toBe(0)
    f.reject(new Error('Late renderer rejection'))
    await Promise.resolve()
  })

  it('registers destruction before invoking renderer evaluation', async () => {
    const f = fixture()
    f.page.executeJavaScript.mockImplementation(() => { f.destroy(); return new Promise(() => undefined) })
    await clearRendererAgentInputFlag(f.page)
    expect(f.page.listenerCount('destroyed')).toBe(0)
  })

  it('does not dispatch into an already destroyed document', async () => {
    const f = fixture()
    f.destroy()
    await clearRendererAgentInputFlag(f.page)
    expect(f.page.executeJavaScript).not.toHaveBeenCalled()
    expect(f.page.listenerCount('destroyed')).toBe(0)
  })

  it.each(['reject', 'throw'] as const)('retains best-effort behavior on %s and removes its listener', async mode => {
    const f = fixture()
    if (mode === 'throw') f.page.executeJavaScript.mockImplementation(() => { throw new Error('Destroyed before dispatch') })
    const pending = clearRendererAgentInputFlag(f.page)
    if (mode === 'reject') f.reject(new Error('Renderer unavailable'))
    await pending
    expect(f.page.listenerCount('destroyed')).toBe(0)
  })

  it('does not abandon a live document on detach, navigation or cancellation', async () => {
    const f = fixture()
    let settled = false
    const pending = clearRendererAgentInputFlag(f.page).then(() => { settled = true })
    for (const event of ['detach', 'did-navigate', 'abort']) f.page.emit(event)
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(f.page.listenerCount('destroyed')).toBe(1)
    f.resolve(true)
    await pending
    expect(f.page.listenerCount('destroyed')).toBe(0)
  })
})

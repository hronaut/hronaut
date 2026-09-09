import { afterEach, describe, expect, it, vi } from 'vitest'
import { continuityMarkerScript, readContinuityMarker } from '../../src/shared/workspace-continuity-marker.js'

afterEach(() => { document.body.replaceChildren(); vi.useRealTimers() })
const read = (selector: string): unknown => window.eval(continuityMarkerScript(selector))

describe('opt-in continuity marker', () => {
  it('reads one explicit marker including nested text without running page code', () => {
    document.body.innerHTML = '<div id="marker">Account <span>fixture</span></div>'
    expect(read('#marker')).toBe('Account fixture')
  })
  it('rejects missing, ambiguous and invalid selectors', () => {
    document.body.innerHTML = '<span>first</span><span>second</span>'
    for (const selector of ['#missing', 'span', '[']) expect(read(selector)).toBeNull()
    for (const selector of ['', ' ', 'x'.repeat(257), 'é'.repeat(129)]) expect(() => read(selector)).toThrow('selector')
  })
  it('rejects oversized text instead of silently matching a truncated prefix', () => {
    const marker = document.createElement('div'); marker.id = 'marker'; document.body.append(marker)
    marker.textContent = 'é'.repeat(256); expect(read('#marker')).toBe(marker.textContent)
    marker.textContent += 'x'; expect(read('#marker')).toBeNull()
    marker.textContent = 'x'.repeat(513); expect(read('#marker')).toBeNull()
  })
  it('bounds traversal even for many empty text nodes', () => {
    const marker = document.createElement('div'); marker.id = 'marker'; document.body.append(marker)
    for (let i = 0; i < 1025; i++) marker.append(document.createTextNode(''))
    expect(read('#marker')).toBeNull()
  })
  it('bounds a stalled read and handles a late rejection', async () => {
    vi.useFakeTimers()
    let reject!: (error: Error) => void
    const result = readContinuityMarker(() => new Promise((_resolve, fail) => { reject = fail }))
    await vi.advanceTimersByTimeAsync(2000)
    expect(await result).toBeNull()
    reject(new Error('private page error'))
    await Promise.resolve()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('rejects malformed results and clears its deadline after completion', async () => {
    vi.useFakeTimers()
    for (const value of [undefined, 1, {}, 'x'.repeat(513)]) expect(await readContinuityMarker(async () => value)).toBeNull()
    expect(await readContinuityMarker(async () => 'fixture')).toBe('fixture')
    expect(await readContinuityMarker(async () => { throw new Error('private') })).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })
})

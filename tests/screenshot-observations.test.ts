import { describe, expect, it } from 'vitest'
import type { TrackedScreenshot } from '../src/main/browser/screenshot-observations/tracked-screenshot.js'
import { SCREENSHOT_OBSERVATION_LIMITS, ScreenshotObservations } from '../src/main/mcp/tools/browser-screenshot/screenshot-observations.js'

const capture = (digest: string, comparable: string | null = 'page-a'): TrackedScreenshot => ({
  tabId: 'tab-1',
  data: Buffer.from('png'),
  mimeType: 'image/png',
  pixels: { digest, width: 10, height: 10 },
  ...(comparable === null ? {} : { comparable })
})

function observations() {
  let now = 1_000
  return { store: new ScreenshotObservations(() => now), advance: (ms: number) => { now += ms } }
}

describe('ScreenshotObservations', () => {
  it('reports unchanged pixels without keeping a new observation, and changed pixels with a fresh id', () => {
    const { store } = observations()
    const first = store.observe('workspace-1', capture('a'))
    expect(first).toEqual({ status: 'NEW', observationId: expect.any(String) })
    const id = (first as { observationId: string }).observationId
    expect(store.observe('workspace-1', capture('a'), id)).toEqual({ status: 'UNCHANGED', observationId: id })
    const changed = store.observe('workspace-1', capture('b'), id)
    expect(changed).toEqual({ status: 'CHANGED', observationId: expect.any(String), comparedWith: id })
    // The named observation stays the same: a later call can still compare with it.
    expect(store.observe('workspace-1', capture('a'), id)).toEqual({ status: 'UNCHANGED', observationId: id })
  })

  it('treats ids from another workspace, unknown ids and expired ids alike', () => {
    const { store, advance } = observations()
    const id = (store.observe('workspace-1', capture('a')) as { observationId: string }).observationId
    const unknown = { status: 'NEW', observationId: expect.any(String), baseline: 'unavailable', reason: 'unknown-or-expired' }
    expect(store.observe('workspace-2', capture('a'), id)).toEqual(unknown)
    expect(store.observe('workspace-1', capture('a'), '00000000-0000-4000-8000-000000000000')).toEqual(unknown)
    advance(SCREENSHOT_OBSERVATION_LIMITS.idleMs - 1)
    expect(store.observe('workspace-1', capture('a'), id).status).toBe('UNCHANGED')
    // Using an observation keeps it; ten idle minutes after that use it is gone.
    advance(SCREENSHOT_OBSERVATION_LIMITS.idleMs + 1)
    expect(store.observe('workspace-1', capture('a'), id)).toEqual(unknown)
  })

  it('never compares captures of another page state, geometry or capture option, even with the same pixels', () => {
    const { store } = observations()
    const id = (store.observe('workspace-1', capture('a', 'page-a')) as { observationId: string }).observationId
    expect(store.observe('workspace-1', capture('a', 'page-b'), id)).toEqual({ status: 'NEW', observationId: expect.any(String), baseline: 'unavailable', reason: 'not-comparable' })
  })

  it('keeps nothing from a capture whose page changed while it was taken', () => {
    const { store } = observations()
    const id = (store.observe('workspace-1', capture('a')) as { observationId: string }).observationId
    expect(store.observe('workspace-1', capture('a', null), id)).toEqual({ status: 'NOT_TRACKED', reason: 'changed-during-capture' })
    expect(store.observe('workspace-1', capture('a', null))).toEqual({ status: 'NOT_TRACKED', reason: 'changed-during-capture' })
  })

  it('keeps the 16 most recently used observations', () => {
    const { store } = observations()
    const ids = Array.from({ length: SCREENSHOT_OBSERVATION_LIMITS.retained }, (_, index) =>
      (store.observe('workspace-1', capture(`d${index}`)) as { observationId: string }).observationId)
    // Using the oldest makes it the newest, so the next new observation evicts the second oldest instead.
    expect(store.observe('workspace-1', capture('d0'), ids[0]).status).toBe('UNCHANGED')
    store.observe('workspace-1', capture('extra'))
    expect(store.observe('workspace-1', capture('d0'), ids[0]).status).toBe('UNCHANGED')
    expect(store.observe('workspace-1', capture('d1'), ids[1])).toMatchObject({ reason: 'unknown-or-expired' })
  })
})

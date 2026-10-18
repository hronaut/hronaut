import { describe, expect, it } from 'vitest'
import type { TrackedScreenshot } from '../src/main/browser/screenshot-observations/tracked-screenshot.js'
import { SCREENSHOT_OBSERVATION_LIMITS, ScreenshotObservations } from '../src/main/mcp/tools/browser-screenshot/screenshot-observations.js'

const capture = (digest: string, comparable: string | null = 'page-a'): TrackedScreenshot => ({
  tabId: 'tab-1',
  data: Buffer.from('png'),
  mimeType: 'image/png',
  pixels: { digest, width: 10, height: 10 },
  ...(comparable === null ? { untracked: 'geometry-unavailable' as const } : { comparable })
})

function observations() {
  let now = 1_000
  const store = new ScreenshotObservations(() => now)
  /** Compares and, as a published result does, keeps what the comparison would keep. */
  const published = (workspaceId: string, value: TrackedScreenshot, ifChangedSince?: string) => {
    const { report, commit } = store.observe(workspaceId, value, ifChangedSince)
    commit()
    return report
  }
  const keptId = (value: TrackedScreenshot) => (published('workspace-1', value) as { observationId: string }).observationId
  return { store, published, keptId, advance: (ms: number) => { now += ms } }
}

describe('ScreenshotObservations', () => {
  it('reports unchanged pixels without keeping a new observation, and changed pixels with a fresh id', () => {
    const { published } = observations()
    const first = published('workspace-1', capture('a'))
    expect(first).toEqual({ status: 'NEW', observationId: expect.any(String) })
    const id = (first as { observationId: string }).observationId
    expect(published('workspace-1', capture('a'), id)).toEqual({ status: 'UNCHANGED', observationId: id })
    const changed = published('workspace-1', capture('b'), id)
    expect(changed).toEqual({ status: 'CHANGED', observationId: expect.any(String), comparedWith: id })
    // The named observation stays the same: a later call can still compare with it.
    expect(published('workspace-1', capture('a'), id)).toEqual({ status: 'UNCHANGED', observationId: id })
    expect(published('workspace-1', capture('b'), (changed as { observationId: string }).observationId).status).toBe('UNCHANGED')
  })

  it('treats ids from another workspace, unknown ids and expired ids alike', () => {
    const { published, keptId, advance } = observations()
    const id = keptId(capture('a'))
    const unknown = { status: 'NEW', observationId: expect.any(String), baseline: 'unavailable', reason: 'unknown-or-expired' }
    expect(published('workspace-2', capture('a'), id)).toEqual(unknown)
    expect(published('workspace-1', capture('a'), '00000000-0000-4000-8000-000000000000')).toEqual(unknown)
    advance(SCREENSHOT_OBSERVATION_LIMITS.idleMs - 1)
    expect(published('workspace-1', capture('a'), id).status).toBe('UNCHANGED')
    // Using an observation keeps it; ten idle minutes after that use it is gone.
    advance(SCREENSHOT_OBSERVATION_LIMITS.idleMs + 1)
    expect(published('workspace-1', capture('a'), id)).toEqual(unknown)
  })

  it('never compares captures of another page state, geometry or capture option, even with the same pixels', () => {
    const { published, keptId } = observations()
    const id = keptId(capture('a', 'page-a'))
    expect(published('workspace-1', capture('a', 'page-b'), id)).toEqual({ status: 'NEW', observationId: expect.any(String), baseline: 'unavailable', reason: 'not-comparable' })
  })

  it('keeps nothing from a capture that cannot be compared, and says why', () => {
    const { published, keptId } = observations()
    const id = keptId(capture('a'))
    expect(published('workspace-1', capture('a', null), id)).toEqual({ status: 'NOT_TRACKED', reason: 'geometry-unavailable' })
    expect(published('workspace-1', { ...capture('a', null), untracked: 'changed-during-capture' })).toEqual({ status: 'NOT_TRACKED', reason: 'changed-during-capture' })
    expect(published('workspace-1', capture('a'), id).status).toBe('UNCHANGED')
  })

  it('keeps nothing and moves nothing for a result that was never published', () => {
    const { store, published, keptId } = observations()
    const ids = Array.from({ length: SCREENSHOT_OBSERVATION_LIMITS.retained }, (_, index) => keptId(capture(`d${index}`)))
    // Withheld results: a new observation that would evict the oldest, and a match that would make the oldest the newest.
    const withheld = store.observe('workspace-1', capture('withheld'))
    expect(store.observe('workspace-1', capture('d0'), ids[0]).report.status).toBe('UNCHANGED')
    expect(published('workspace-1', capture('withheld'), (withheld.report as { observationId: string }).observationId)).toMatchObject({ reason: 'unknown-or-expired' })
    // That published NEW observation evicted the oldest, which the withheld match did not protect.
    expect(published('workspace-1', capture('d0'), ids[0])).toMatchObject({ reason: 'unknown-or-expired' })
    expect(published('workspace-1', capture('d2'), ids[2]).status).toBe('UNCHANGED')
  })

  it('keeps the 16 most recently used observations', () => {
    const { published, keptId } = observations()
    const ids = Array.from({ length: SCREENSHOT_OBSERVATION_LIMITS.retained }, (_, index) => keptId(capture(`d${index}`)))
    // Using the oldest makes it the newest, so the next new observation evicts the second oldest instead.
    expect(published('workspace-1', capture('d0'), ids[0]).status).toBe('UNCHANGED')
    keptId(capture('extra'))
    expect(published('workspace-1', capture('d0'), ids[0]).status).toBe('UNCHANGED')
    expect(published('workspace-1', capture('d1'), ids[1])).toMatchObject({ reason: 'unknown-or-expired' })
  })
})

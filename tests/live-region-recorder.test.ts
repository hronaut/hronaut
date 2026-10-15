import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import {
  BrowserLiveRegionRecorder,
  liveRegionRecordingKeepsTabAwake,
  type BrowserLiveRegionRecordingState
} from '../src/main/browser/live-region-recorder.js'
import { LIVE_REGION_LIMITS, liveRegionPageScript } from '../src/shared/live-region.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

function fixture() {
  const pageReport = {
    selector: '#status', startedAt: '2026-10-15T00:00:00.000Z', active: true,
    metadata: { role: 'status' }, initial: { text: 'Idle', empty: false, truncated: false },
    observations: [], callbackCount: 0, unchangedCallbacks: 0, totalChars: 4
  }
  const execute = vi.fn(async (): Promise<unknown> => pageReport)
  const destroyed = vi.fn(() => false)
  const tab = {
    id: 'live-tab', title: 'Live fixture', url: 'https://example.test/search?token=private-token#private-hash',
    navigationGeneration: 1, observationGeneration: 1,
    webContents: { executeJavaScriptInIsolatedWorld: execute, isDestroyed: destroyed } as unknown as WebContents,
    liveRegionRecording: undefined as BrowserLiveRegionRecordingState | undefined
  }
  const isCurrent = vi.fn(() => true)
  const recorder = new BrowserLiveRegionRecorder({ isCurrent })
  return { tab, recorder, execute, destroyed, isCurrent, pageReport }
}

describe('live region recorder ownership', () => {
  it('starts in its own isolated world and reports limits and the private-text caveat', async () => {
    const f = fixture()
    const report = await f.recorder.manage(f.tab, 'start', '  #status  ')
    expect(f.execute).toHaveBeenCalledWith(1024, [{ code: liveRegionPageScript('start', '#status') }], false)
    expect(report).toMatchObject({ tabId: 'live-tab', active: true, initial: { text: 'Idle' }, limits: { maxObservations: 100, maxTotalChars: 50_000 } })
    expect(report.url).not.toContain('private')
    expect(report.caveats.join(' ')).toMatch(/private information/)
    expect(f.tab.liveRegionRecording).toEqual({ active: true, startedAt: f.pageReport.startedAt, observationGeneration: 1 })
  })

  it('requires a bounded selector before touching the page', async () => {
    const f = fixture()
    await expect(f.recorder.manage(f.tab, 'start')).rejects.toThrow('Provide a CSS selector')
    await expect(f.recorder.manage(f.tab, 'start', 'x'.repeat(LIVE_REGION_LIMITS.maxSelectorChars + 1))).rejects.toThrow('Provide a CSS selector')
    expect(f.execute).not.toHaveBeenCalled()
  })

  it('maps a rejected selection to a clear error and forgets the earlier recording', async () => {
    const f = fixture()
    await f.recorder.manage(f.tab, 'start', '#status')
    f.execute.mockResolvedValueOnce({ error: 'not-unique' })
    await expect(f.recorder.manage(f.tab, 'start', 'div')).rejects.toThrow('matches more than one element')
    expect(f.tab.liveRegionRecording).toBeUndefined()
  })

  it.each(['workspace', 'navigation', 'replacement', 'destroyed', 'removed'] as const)('rejects a delayed result after its %s context changes', async change => {
    const f = fixture()
    const held = deferred<unknown>()
    f.execute.mockReturnValueOnce(held.promise)
    const result = f.recorder.manage(f.tab, 'start', '#status')
    const rejected = expect(result).rejects.toThrow(/changed while reading the live region/)
    if (change === 'workspace') f.tab.observationGeneration++
    else if (change === 'navigation') f.tab.navigationGeneration++
    else if (change === 'replacement') f.tab.webContents = { isDestroyed: () => false } as unknown as WebContents
    else if (change === 'destroyed') f.destroyed.mockReturnValue(true)
    else f.isCurrent.mockReturnValue(false)
    held.resolve(f.pageReport)
    await rejected
    expect(f.tab.liveRegionRecording).toBeUndefined()
  })

  it('clears a previous workspace observation instead of returning its text', async () => {
    const f = fixture()
    f.tab.liveRegionRecording = { active: true, startedAt: f.pageReport.startedAt, observationGeneration: 0 }
    f.execute.mockResolvedValueOnce({ active: false, observations: [], callbackCount: 0, unchangedCallbacks: 0, totalChars: 0 })
    const report = await f.recorder.manage(f.tab, 'get')
    expect(f.execute).toHaveBeenCalledWith(1024, [{ code: liveRegionPageScript('clear') }], false)
    expect(report).toMatchObject({ active: false, observations: [] })
    expect(f.tab.liveRegionRecording).toBeUndefined()
  })

  it('releases retained page text on workspace control change, including a start still in flight', async () => {
    const f = fixture()
    const held = deferred<unknown>()
    f.execute.mockReturnValueOnce(held.promise)
    const start = f.recorder.manage(f.tab, 'start', '#status')
    f.tab.observationGeneration++
    f.recorder.release(f.tab)
    expect(f.execute).toHaveBeenLastCalledWith(1024, [{ code: liveRegionPageScript('clear') }], false)
    held.resolve(f.pageReport)
    await expect(start).rejects.toThrow('Workspace control changed')
    expect(f.tab.liveRegionRecording).toBeUndefined()
  })

  it('does not touch a page that never recorded or has been destroyed', () => {
    const f = fixture()
    f.recorder.release(f.tab)
    expect(f.execute).not.toHaveBeenCalled()
    f.tab.liveRegionRecording = { active: true, startedAt: f.pageReport.startedAt, observationGeneration: 1 }
    f.destroyed.mockReturnValue(true)
    f.recorder.release(f.tab)
    expect(f.execute).not.toHaveBeenCalled()
    expect(f.tab.liveRegionRecording).toBeUndefined()
  })

  it('clears page-side state when no current recording exists, such as a document restored from the back/forward cache', async () => {
    const f = fixture()
    f.execute.mockResolvedValue({ active: false, observations: [], callbackCount: 0, unchangedCallbacks: 0, totalChars: 0 })
    for (const action of ['get', 'stop'] as const) {
      await expect(f.recorder.manage(f.tab, action)).resolves.toMatchObject({ active: false, observations: [] })
      expect(f.execute).toHaveBeenLastCalledWith(1024, [{ code: liveRegionPageScript('clear') }], false)
    }
  })

  it('refuses the Hronaut home page', async () => {
    const f = fixture()
    f.tab.url = 'hronaut://home/'
    await expect(f.recorder.manage(f.tab, 'get')).rejects.toThrow('Open a website tab')
  })
})

describe('live region sleep guard', () => {
  const startedAt = '2026-10-15T00:00:00.000Z'
  const started = Date.parse(startedAt)

  it('keeps a tab awake only while a current recording can still be active', () => {
    const recording = { active: true, startedAt, observationGeneration: 2 }
    expect(liveRegionRecordingKeepsTabAwake({ liveRegionRecording: recording, observationGeneration: 2 }, started + 1_000)).toBe(true)
    expect(liveRegionRecordingKeepsTabAwake({ liveRegionRecording: recording, observationGeneration: 2 }, started + LIVE_REGION_LIMITS.maxDurationMs)).toBe(false)
    expect(liveRegionRecordingKeepsTabAwake({ liveRegionRecording: recording, observationGeneration: 3 }, started + 1_000)).toBe(false)
    expect(liveRegionRecordingKeepsTabAwake({ liveRegionRecording: { ...recording, active: false }, observationGeneration: 2 }, started)).toBe(false)
    expect(liveRegionRecordingKeepsTabAwake({ liveRegionRecording: undefined, observationGeneration: 2 }, started)).toBe(false)
  })
})

import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { BrowserDomRecorder, type BrowserDomRecordingState } from '../src/main/browser/dom-recorder.js'
import { domChangesPageScript } from '../src/shared/dom-changes.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

function fixture() {
  const pageReport = {
    active: true, startedAt: '2026-09-24T00:00:00.000Z', changeCount: 3,
    entries: [], truncated: false, droppedChanges: 0,
    summary: { childList: 3, attributes: 0, text: 0, addedNodes: 3, removedNodes: 0 }
  }
  const execute = vi.fn(async () => pageReport)
  const destroyed = vi.fn(() => false)
  const tab = {
    id: 'dom-tab', title: 'DOM fixture', url: 'https://example.test/',
    navigationGeneration: 1, observationGeneration: 1,
    webContents: { executeJavaScriptInIsolatedWorld: execute, isDestroyed: destroyed } as unknown as WebContents,
    domChangesRecording: undefined as BrowserDomRecordingState | undefined
  }
  const isCurrent = vi.fn(() => true)
  const changed = vi.fn()
  const recorder = new BrowserDomRecorder({ isCurrent, changed })
  return { tab, recorder, execute, destroyed, isCurrent, changed, pageReport }
}

describe('DOM recorder ownership', () => {
  it.each(['workspace', 'replacement', 'destroyed', 'removed'] as const)('rejects a delayed result after its %s context changes', async change => {
    const f = fixture()
    const held = deferred<typeof f.pageReport>()
    f.execute.mockReturnValueOnce(held.promise)
    const result = f.recorder.manage(f.tab, 'start')
    const rejected = expect(result).rejects.toThrow('changed while reading DOM changes')
    if (change === 'workspace') f.tab.observationGeneration++
    else if (change === 'replacement') f.tab.webContents = { isDestroyed: () => false } as unknown as WebContents
    else if (change === 'destroyed') f.destroyed.mockReturnValue(true)
    else f.isCurrent.mockReturnValue(false)
    held.resolve(f.pageReport)
    await rejected
    expect(f.tab.domChangesRecording).toBeUndefined()
    expect(f.changed).not.toHaveBeenCalled()
  })

  it('clears a previous workspace observation before returning its recording data', async () => {
    const f = fixture()
    f.tab.domChangesRecording = { active: true, startedAt: f.pageReport.startedAt, changeCount: 3, observationGeneration: 0 }
    const empty = {
      ...f.pageReport, active: false, startedAt: '', changeCount: 0,
      summary: { childList: 0, attributes: 0, text: 0, addedNodes: 0, removedNodes: 0 }
    }
    f.execute.mockResolvedValueOnce(empty)
    const report = await f.recorder.manage(f.tab, 'get')
    expect(f.execute).toHaveBeenCalledWith(1005, [{ code: domChangesPageScript('clear') }], false)
    expect(report).toMatchObject({ active: false, changeCount: 0 })
    expect(f.tab.domChangesRecording).toBeUndefined()
  })

  it('preserves a pending start when a later refresh fails', async () => {
    const f = fixture()
    const held = deferred<typeof f.pageReport>()
    f.execute.mockReturnValueOnce(held.promise)
    const start = f.recorder.manage(f.tab, 'start')
    f.execute.mockRejectedValueOnce(new Error('Refresh unavailable'))
    await expect(f.recorder.manage(f.tab, 'get')).rejects.toThrow('Refresh unavailable')
    held.resolve(f.pageReport)
    expect(await start).toMatchObject({ active: true, changeCount: 3 })
    expect(f.tab.domChangesRecording).toMatchObject({ active: true, observationGeneration: 1 })
    expect(f.changed).toHaveBeenCalledTimes(1)
  })
})

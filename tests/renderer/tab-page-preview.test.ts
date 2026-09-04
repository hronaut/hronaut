import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useTabPagePreview } from '../../src/renderer/src/composables/useTabPagePreview.js'
import type { BrowserTabOverviewPreview, BrowserTabState } from '../../src/shared/types.js'

function deferred() {
  let resolve!: (value: BrowserTabOverviewPreview) => void
  const promise = new Promise<BrowserTabOverviewPreview>((done) => { resolve = done })
  return { promise, resolve }
}
function fixture() {
  const open = ref(true)
  const tabs = ref([{ id: 'alpha', navigationGeneration: 1, loading: false, sleeping: false },
    { id: 'beta', navigationGeneration: 1, loading: false, sleeping: false }] as BrowserTabState[])
  const image = (tabId = 'alpha', navigationGeneration = 1): BrowserTabOverviewPreview => ({
    tabId, navigationGeneration, dataUrl: 'data:image/jpeg;base64,YWJj', width: 1000, height: 4000
  })
  const capture = vi.fn(async (_id: string) => image())
  return { open, tabs, capture, image, preview: useTabPagePreview({ open, tabs, capture }) }
}

describe('full-page preview lifecycle', () => {
  it('captures only explicitly and retains a valid capture across unrelated state updates', async () => {
    const f = fixture()
    expect(f.capture).not.toHaveBeenCalled()
    await f.preview.show(f.tabs.value[0])
    expect(f.preview.status.value).toBe('ready')
    f.tabs.value = f.tabs.value.map((tab) => ({ ...tab, title: 'Updated title' }))
    expect(f.preview.preview.value).toEqual(f.image())
    expect(f.capture).toHaveBeenCalledTimes(1)
    f.preview.dispose()
  })
  it.each(['back', 'close', 'navigate', 'sleep', 'remove'] as const)('discards a late capture after %s', async (action) => {
    const f = fixture()
    const delayed = deferred()
    f.capture.mockReturnValueOnce(delayed.promise)
    const showing = f.preview.show(f.tabs.value[0])
    if (action === 'back') f.preview.back()
    if (action === 'close') f.open.value = false
    if (action === 'navigate') f.tabs.value[0].navigationGeneration += 1
    if (action === 'sleep') f.tabs.value[0].sleeping = true
    if (action === 'remove') f.tabs.value = []
    delayed.resolve(f.image())
    await showing
    expect(f.preview.preview.value).toBeNull()
    expect(f.preview.status.value).not.toBe('loading')
    f.preview.dispose()
  })
  it('accepts a pending capture across equivalent state refreshes', async () => {
    const f = fixture()
    const delayed = deferred()
    f.capture.mockReturnValueOnce(delayed.promise)
    const showing = f.preview.show(f.tabs.value[0])
    f.tabs.value = f.tabs.value.map((tab) => ({ ...tab }))
    expect(f.preview.status.value).toBe('loading')
    delayed.resolve(f.image())
    await showing
    expect(f.preview.status.value).toBe('ready')
    f.preview.dispose()
  })
  it('does not allow an older tab capture to replace the newly requested tab', async () => {
    const f = fixture()
    const delayed = deferred()
    f.capture.mockReturnValueOnce(delayed.promise).mockResolvedValueOnce(f.image('beta'))
    const first = f.preview.show(f.tabs.value[0])
    await f.preview.show(f.tabs.value[1])
    delayed.resolve(f.image())
    await first
    expect(f.preview.preview.value?.tabId).toBe('beta')
    f.preview.dispose()
  })
  it('contains a rejection and supports an explicit retry', async () => {
    const f = fixture()
    f.capture.mockRejectedValueOnce(new Error('DevTools owns target'))
    await f.preview.show(f.tabs.value[0])
    expect(f.preview.status.value).toBe('error')
    expect(f.preview.error.value).toBeInstanceOf(Error)
    f.tabs.value[0].navigationGeneration = 2
    expect(f.preview.error.value).toBeNull()
    f.capture.mockResolvedValueOnce(f.image('alpha', 2))
    await f.preview.refresh()
    expect(f.preview.status.value).toBe('ready')
    f.preview.dispose()
  })
  it('clears an already displayed image immediately on navigation and does not capture until retry', async () => {
    const f = fixture()
    await f.preview.show(f.tabs.value[0])
    f.tabs.value[0].navigationGeneration += 1
    expect(f.preview.preview.value).toBeNull()
    expect(f.preview.status.value).toBe('changed')
    expect(f.capture).toHaveBeenCalledTimes(1)
    f.capture.mockResolvedValueOnce(f.image('alpha', 2))
    await f.preview.refresh()
    expect(f.preview.status.value).toBe('ready')
    f.preview.dispose()
  })
  it.each(['sleeping', 'loading'] as const)('never captures a %s tab', async (property) => {
    const f = fixture()
    f.tabs.value[0][property] = true
    await f.preview.show(f.tabs.value[0])
    expect(f.capture).not.toHaveBeenCalled()
    expect(f.preview.status.value).toBe('changed')
    f.preview.dispose()
  })
  it('rejects mismatched and malformed bridge images', async () => {
    const f = fixture()
    for (const invalid of [{ ...f.image(), width: 0 }, f.image('beta'), { ...f.image(), dataUrl: 'https://example.test/private' }]) {
      f.capture.mockResolvedValueOnce(invalid)
      await f.preview.show(f.tabs.value[0])
      expect(f.preview.status.value).toBe('error')
      expect(f.preview.preview.value).toBeNull()
    }
    f.preview.dispose()
  })
})

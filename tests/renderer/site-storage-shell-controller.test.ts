import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useSiteStorageShellController } from '../../src/renderer/src/composables/useSiteStorageShellController.js'

function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function createController(keepsSeparatePanelOpen = false) {
  const open = ref(false)
  const panel = ref({
    reset: vi.fn(),
    refresh: vi.fn<() => Promise<void>>(async () => undefined)
  })
  const competingUi = {
    settingsOpen: ref(true),
    siteControlsOpen: ref(true),
    downloadsOpen: ref(true),
    bookmarksOpen: ref(true),
    historyOpen: ref(true),
    tabSearchOpen: ref(true),
    zoomOpen: ref(true),
    addressSuggestionsOpen: ref(true)
  }
  const controller = useSiteStorageShellController({
    open,
    panel,
    keepsSeparatePanelOpen: () => keepsSeparatePanelOpen,
    ...competingUi
  })
  return { open, panel, competingUi, controller }
}

describe('useSiteStorageShellController', () => {
  it('opens after closing competing surfaces and resets before refreshing', async () => {
    const harness = createController()

    await harness.controller.toggle()

    expect(harness.open.value).toBe(true)
    expect(Object.values(harness.competingUi).every((item) => !item.value)).toBe(true)
    expect(harness.panel.value.reset).toHaveBeenCalledOnce()
    expect(harness.panel.value.refresh).toHaveBeenCalledOnce()
    expect(harness.panel.value.reset.mock.invocationCallOrder[0])
      .toBeLessThan(harness.panel.value.refresh.mock.invocationCallOrder[0])
    harness.controller.dispose()
  })

  it('lets a newer close suppress an obsolete refresh failure', async () => {
    const harness = createController()
    const refreshing = deferred<void>()
    harness.panel.value.refresh.mockReturnValueOnce(refreshing.promise)

    const opening = harness.controller.toggle()
    await vi.waitFor(() => expect(harness.panel.value.refresh).toHaveBeenCalledOnce())
    await harness.controller.toggle()
    refreshing.reject(new Error('obsolete storage failure'))

    await expect(opening).resolves.toBeUndefined()
    expect(harness.open.value).toBe(false)
    harness.controller.dispose()
  })

  it('invalidates an opening refresh when a separate panel resets for a newer tab', async () => {
    const harness = createController(true)
    const refreshing = deferred<void>()
    harness.panel.value.refresh.mockReturnValueOnce(refreshing.promise)

    const opening = harness.controller.open()
    await vi.waitFor(() => expect(harness.panel.value.refresh).toHaveBeenCalledOnce())
    harness.controller.reset(true)
    refreshing.reject(new Error('old tab storage failure'))

    await expect(opening).resolves.toBeUndefined()
    expect(harness.open.value).toBe(true)
    expect(harness.panel.value.reset).toHaveBeenLastCalledWith(true)
    harness.controller.dispose()
  })

  it('preserves the active panel and current refresh failure for shell reporting', async () => {
    const harness = createController()
    const failure = new Error('storage unavailable')
    harness.panel.value.refresh.mockRejectedValueOnce(failure)

    await expect(harness.controller.open()).rejects.toBe(failure)

    expect(harness.open.value).toBe(true)
    harness.controller.dispose()
  })

  it('closes an embedded panel during a context reset', () => {
    const harness = createController()
    harness.open.value = true

    harness.controller.reset(true)

    expect(harness.open.value).toBe(false)
    expect(harness.panel.value.reset).toHaveBeenCalledWith(true)
    harness.controller.dispose()
  })
})

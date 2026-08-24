import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useSiteControlsShellController } from '../../src/renderer/src/composables/useSiteControlsShellController.js'

function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function createController() {
  const open = ref(false)
  const canOpen = vi.fn(() => true)
  const competingUi = {
    settingsOpen: ref(true),
    updateNoticeOpen: ref(true),
    downloadsOpen: ref(true),
    bookmarksOpen: ref(true),
    historyOpen: ref(true),
    tabSearchOpen: ref(true),
    zoomOpen: ref(true),
    addressSuggestionsOpen: ref(true)
  }
  const findOpen = ref(true)
  const closeFind = vi.fn<() => Promise<void>>(async () => undefined)
  const refresh = vi.fn<() => Promise<void>>(async () => undefined)
  const controller = useSiteControlsShellController({
    open,
    canOpen,
    ...competingUi,
    findOpen,
    closeFind,
    refresh
  })
  return { open, canOpen, competingUi, findOpen, closeFind, refresh, controller }
}

describe('useSiteControlsShellController', () => {
  it('does nothing when the active page cannot expose site controls', async () => {
    const harness = createController()
    harness.canOpen.mockReturnValue(false)

    await harness.controller.toggle()

    expect(harness.open.value).toBe(false)
    expect(Object.values(harness.competingUi).every((item) => item.value)).toBe(true)
    expect(harness.closeFind).not.toHaveBeenCalled()
    expect(harness.refresh).not.toHaveBeenCalled()
    harness.controller.dispose()
  })

  it('opens before blocking cleanup and refreshes only after cleanup finishes', async () => {
    const harness = createController()
    const closing = deferred<void>()
    harness.closeFind.mockReturnValueOnce(closing.promise)

    const opening = harness.controller.toggle()
    expect(harness.open.value).toBe(true)
    expect(harness.refresh).not.toHaveBeenCalled()

    closing.resolve()
    await opening

    expect(Object.values(harness.competingUi).every((item) => !item.value)).toBe(true)
    expect(harness.refresh).toHaveBeenCalledOnce()
    harness.controller.dispose()
  })

  it('does not finish opening after a newer surface closes Site Controls', async () => {
    const harness = createController()
    const closing = deferred<void>()
    harness.closeFind.mockReturnValueOnce(closing.promise)

    const opening = harness.controller.toggle()
    harness.open.value = false
    closing.resolve()
    await opening

    expect(harness.open.value).toBe(false)
    expect(harness.refresh).not.toHaveBeenCalled()
    harness.controller.dispose()
  })

  it('lets a second toggle close Site Controls while cleanup is pending', async () => {
    const harness = createController()
    const closing = deferred<void>()
    harness.closeFind.mockReturnValueOnce(closing.promise)

    const opening = harness.controller.toggle()
    await harness.controller.toggle()
    closing.resolve()
    await opening

    expect(harness.open.value).toBe(false)
    expect(harness.refresh).not.toHaveBeenCalled()
    harness.controller.dispose()
  })

  it('closes and preserves a failure from the current blocking cleanup', async () => {
    const harness = createController()
    const failure = new Error('find cleanup unavailable')
    harness.closeFind.mockRejectedValueOnce(failure)

    await expect(harness.controller.toggle()).rejects.toBe(failure)

    expect(harness.open.value).toBe(false)
    expect(harness.refresh).not.toHaveBeenCalled()
    harness.controller.dispose()
  })

  it('suppresses an obsolete cleanup failure after Site Controls is closed and reopened', async () => {
    const harness = createController()
    const older = deferred<void>()
    const newer = deferred<void>()
    harness.closeFind
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise)

    const firstOpening = harness.controller.toggle()
    await harness.controller.toggle()
    const secondOpening = harness.controller.toggle()
    older.reject(new Error('older failure'))
    newer.resolve()

    await expect(firstOpening).resolves.toBeUndefined()
    await expect(secondOpening).resolves.toBeUndefined()
    expect(harness.open.value).toBe(true)
    expect(harness.refresh).toHaveBeenCalledOnce()
    harness.controller.dispose()
  })

  it('keeps the panel open for a current refresh failure but suppresses a stale one', async () => {
    const harness = createController()
    harness.findOpen.value = false
    const older = deferred<void>()
    const newer = deferred<void>()
    harness.refresh
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise)

    const firstOpening = harness.controller.toggle()
    await vi.waitFor(() => expect(harness.refresh).toHaveBeenCalledOnce())
    await harness.controller.toggle()
    const secondOpening = harness.controller.toggle()
    older.reject(new Error('older refresh failure'))
    newer.resolve()

    await expect(firstOpening).resolves.toBeUndefined()
    await expect(secondOpening).resolves.toBeUndefined()
    expect(harness.open.value).toBe(true)

    await harness.controller.toggle()
    harness.refresh.mockRejectedValueOnce(new Error('current refresh failure'))
    await expect(harness.controller.toggle()).rejects.toThrow('current refresh failure')
    expect(harness.open.value).toBe(true)
    harness.controller.dispose()
  })
})

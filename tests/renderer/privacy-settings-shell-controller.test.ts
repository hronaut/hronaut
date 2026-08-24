import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { usePrivacySettingsShellController } from '../../src/renderer/src/composables/usePrivacySettingsShellController.js'
import type { SettingsSection } from '../../src/renderer/src/composables/useSettingsDialogController.js'

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
  const settingsOpen = ref(false)
  const settingsSection = ref<SettingsSection>('appearance')
  const competingUi = {
    updateNoticeOpen: ref(true),
    downloadsOpen: ref(true),
    bookmarksOpen: ref(true),
    historyOpen: ref(true),
    tabSearchOpen: ref(true),
    zoomOpen: ref(true),
    addressSuggestionsOpen: ref(true)
  }
  const findOpen = ref(true)
  const search = ref('older search')
  const openSection = vi.fn((section: SettingsSection) => {
    settingsSection.value = section
    settingsOpen.value = true
  })
  const closeSettings = vi.fn(() => {
    settingsOpen.value = false
  })
  const closeFind = vi.fn<() => Promise<void>>(async () => undefined)
  const controller = usePrivacySettingsShellController({
    settingsOpen,
    settingsSection,
    ...competingUi,
    findOpen,
    search,
    openSection,
    closeSettings,
    closeFind
  })
  return {
    settingsOpen,
    settingsSection,
    competingUi,
    findOpen,
    search,
    openSection,
    closeSettings,
    closeFind,
    controller
  }
}

describe('usePrivacySettingsShellController', () => {
  it('opens Privacy immediately before delayed Find cleanup finishes', async () => {
    const harness = createController()
    const closing = deferred<void>()
    harness.closeFind.mockReturnValueOnce(closing.promise)

    const opening = harness.controller.open('https://example.com')

    expect(harness.settingsOpen.value).toBe(true)
    expect(harness.settingsSection.value).toBe('privacy')
    expect(harness.search.value).toBe('https://example.com')
    expect(Object.values(harness.competingUi).every((item) => !item.value)).toBe(true)

    closing.resolve()
    await opening
    harness.controller.dispose()
  })

  it('does not reopen Privacy after it is closed during cleanup', async () => {
    const harness = createController()
    const closing = deferred<void>()
    harness.closeFind.mockReturnValueOnce(closing.promise)

    const opening = harness.controller.open()
    harness.closeSettings()
    closing.resolve()
    await opening

    expect(harness.settingsOpen.value).toBe(false)
    expect(harness.openSection).toHaveBeenCalledOnce()
    harness.controller.dispose()
  })

  it('suppresses an obsolete cleanup failure after the user changes section', async () => {
    const harness = createController()
    const closing = deferred<void>()
    harness.closeFind.mockReturnValueOnce(closing.promise)

    const opening = harness.controller.open()
    harness.openSection('support')
    closing.reject(new Error('obsolete Find failure'))

    await expect(opening).resolves.toBeUndefined()
    expect(harness.settingsOpen.value).toBe(true)
    expect(harness.settingsSection.value).toBe('support')
    expect(harness.closeSettings).not.toHaveBeenCalled()
    harness.controller.dispose()
  })

  it('closes Privacy and preserves a current cleanup failure', async () => {
    const harness = createController()
    const failure = new Error('Find cleanup unavailable')
    harness.closeFind.mockRejectedValueOnce(failure)

    await expect(harness.controller.open()).rejects.toBe(failure)

    expect(harness.settingsOpen.value).toBe(false)
    expect(harness.closeSettings).toHaveBeenCalledOnce()
    harness.controller.dispose()
  })

  it('keeps the newest Privacy request authoritative', async () => {
    const harness = createController()
    const older = deferred<void>()
    const newer = deferred<void>()
    harness.closeFind
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise)

    const firstOpening = harness.controller.open('https://older.example')
    const secondOpening = harness.controller.open('https://newer.example')
    older.reject(new Error('obsolete Find failure'))
    newer.resolve()

    await expect(firstOpening).resolves.toBeUndefined()
    await expect(secondOpening).resolves.toBeUndefined()
    expect(harness.settingsOpen.value).toBe(true)
    expect(harness.settingsSection.value).toBe('privacy')
    expect(harness.search.value).toBe('https://newer.example')
    harness.controller.dispose()
  })

  it('skips Find cleanup when the bar is already closed', async () => {
    const harness = createController()
    harness.findOpen.value = false

    await harness.controller.open()

    expect(harness.closeFind).not.toHaveBeenCalled()
    expect(harness.search.value).toBe('')
    expect(harness.settingsOpen.value).toBe(true)
    harness.controller.dispose()
  })
})

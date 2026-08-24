import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useSplitViewShellController } from '../../src/renderer/src/composables/useSplitViewShellController.js'

describe('useSplitViewShellController', () => {
  it('starts closed and closes competing shell surfaces before opening', () => {
    const settingsOpen = ref(true)
    const bookmarksOpen = ref(true)
    const closeTransientPanels = vi.fn()
    const reportError = vi.fn()
    const controller = useSplitViewShellController({
      settingsOpen,
      bookmarksOpen,
      closeTransientPanels,
      reportError
    })

    expect(controller.open.value).toBe(false)
    controller.prepareOpen()

    expect(settingsOpen.value).toBe(false)
    expect(bookmarksOpen.value).toBe(false)
    expect(closeTransientPanels).toHaveBeenCalledOnce()
  })

  it('forwards mutation failures with their action-specific fallback', () => {
    const reportError = vi.fn()
    const controller = useSplitViewShellController({
      settingsOpen: ref(false),
      bookmarksOpen: ref(false),
      closeTransientPanels: vi.fn(),
      reportError
    })
    const failure = new Error('split renderer unavailable')

    controller.handleError(failure, 'Split view could not be opened.')

    expect(reportError).toHaveBeenCalledWith(failure, 'Split view could not be opened.')
  })
})

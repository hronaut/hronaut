import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { BrowserTabState } from '../../src/shared/types.js'
import { useZoomShellController } from '../../src/renderer/src/composables/useZoomShellController.js'

const tab = { id: 'tab-1', url: 'https://example.test/' } as BrowserTabState

function createController(activeTab: BrowserTabState | null = tab) {
  const open = ref(false)
  const settingsOpen = ref(true)
  const bookmarksOpen = ref(true)
  const splitMenuOpen = ref(true)
  const bar = ref({
    openForTab: vi.fn(async () => { open.value = true }),
    close: vi.fn(() => { open.value = false })
  })
  const closeTransientPanels = vi.fn()
  const controller = useZoomShellController({
    activeTab: ref(activeTab ?? undefined),
    open,
    bar,
    settingsOpen,
    bookmarksOpen,
    splitMenuOpen,
    closeTransientPanels
  })
  return {
    open,
    settingsOpen,
    bookmarksOpen,
    splitMenuOpen,
    bar,
    closeTransientPanels,
    controller
  }
}

describe('useZoomShellController', () => {
  it('closes competing shell surfaces before opening Zoom for the active tab', async () => {
    const harness = createController()

    await harness.controller.toggle()

    expect(harness.settingsOpen.value).toBe(false)
    expect(harness.bookmarksOpen.value).toBe(false)
    expect(harness.splitMenuOpen.value).toBe(false)
    expect(harness.closeTransientPanels).toHaveBeenCalledOnce()
    expect(harness.bar.value.openForTab).toHaveBeenCalledWith(tab)
    expect(harness.open.value).toBe(true)
  })

  it('uses the bar close lifecycle when Zoom is already open', async () => {
    const harness = createController()
    harness.open.value = true

    await harness.controller.toggle()

    expect(harness.bar.value.close).toHaveBeenCalledOnce()
    expect(harness.bar.value.openForTab).not.toHaveBeenCalled()
    expect(harness.closeTransientPanels).not.toHaveBeenCalled()
    expect(harness.open.value).toBe(false)
  })

  it('does not disturb other surfaces without an active tab', async () => {
    const harness = createController(null)

    await harness.controller.toggle()

    expect(harness.settingsOpen.value).toBe(true)
    expect(harness.bookmarksOpen.value).toBe(true)
    expect(harness.splitMenuOpen.value).toBe(true)
    expect(harness.closeTransientPanels).not.toHaveBeenCalled()
    expect(harness.bar.value.openForTab).not.toHaveBeenCalled()
  })
})

import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useTabSearchShellController } from '../../src/renderer/src/composables/useTabSearchShellController.js'

function createController() {
  const open = ref(false)
  const settingsOpen = ref(true)
  const bookmarksOpen = ref(true)
  const splitMenuOpen = ref(true)
  const panel = ref({
    openPanel: vi.fn(async () => { open.value = true }),
    close: vi.fn(() => { open.value = false })
  })
  const closeTransientPanels = vi.fn()
  const controller = useTabSearchShellController({
    open,
    panel,
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
    panel,
    closeTransientPanels,
    controller
  }
}

describe('useTabSearchShellController', () => {
  it('closes competing shell surfaces before opening Tab Search', async () => {
    const harness = createController()

    await harness.controller.toggle()

    expect(harness.settingsOpen.value).toBe(false)
    expect(harness.bookmarksOpen.value).toBe(false)
    expect(harness.splitMenuOpen.value).toBe(false)
    expect(harness.closeTransientPanels).toHaveBeenCalledOnce()
    expect(harness.panel.value.openPanel).toHaveBeenCalledOnce()
    expect(harness.open.value).toBe(true)
  })

  it('uses the panel close lifecycle when Tab Search is already open', async () => {
    const harness = createController()
    harness.open.value = true

    await harness.controller.toggle()

    expect(harness.panel.value.close).toHaveBeenCalledOnce()
    expect(harness.panel.value.openPanel).not.toHaveBeenCalled()
    expect(harness.closeTransientPanels).not.toHaveBeenCalled()
    expect(harness.open.value).toBe(false)
  })
})

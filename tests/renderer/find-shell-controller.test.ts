import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { BrowserTabState } from '../../src/shared/types.js'
import { useFindShellController } from '../../src/renderer/src/composables/useFindShellController.js'

const tab = { id: 'tab-1', url: 'https://example.com/' } as BrowserTabState

describe('useFindShellController', () => {
  it('closes competing shell surfaces while preserving and opening Find', async () => {
    const settingsOpen = ref(true)
    const splitMenuOpen = ref(true)
    const closeTransientPanels = vi.fn()
    const openForTab = vi.fn(async () => undefined)
    const controller = useFindShellController({
      activeTab: ref(tab),
      settingsOpen,
      splitMenuOpen,
      closeTransientPanels,
      openForTab
    })

    await controller.open()

    expect(settingsOpen.value).toBe(false)
    expect(splitMenuOpen.value).toBe(false)
    expect(closeTransientPanels).toHaveBeenCalledWith({ preserveFind: true })
    expect(openForTab).toHaveBeenCalledWith(tab)
  })

  it.each(['next', 'previous'] as const)('closes competing shell surfaces and finds the %s match', async (again) => {
    const settingsOpen = ref(true)
    const splitMenuOpen = ref(true)
    const closeTransientPanels = vi.fn()
    const openForTab = vi.fn(async (_tab: BrowserTabState, _again?: 'next' | 'previous') => undefined)
    const controller = useFindShellController({ activeTab: ref(tab), settingsOpen, splitMenuOpen, closeTransientPanels, openForTab })

    await controller.findAgain(again)

    expect(settingsOpen.value).toBe(false)
    expect(splitMenuOpen.value).toBe(false)
    expect(closeTransientPanels).toHaveBeenCalledWith({ preserveFind: true })
    expect(openForTab).toHaveBeenCalledWith(tab, again)
    // Find itself still opens without a match to go to.
    await controller.open()
    expect(openForTab).toHaveBeenLastCalledWith(tab)
  })

  it('does nothing without an active tab', async () => {
    const settingsOpen = ref(true)
    const splitMenuOpen = ref(true)
    const closeTransientPanels = vi.fn()
    const openForTab = vi.fn(async () => undefined)
    const controller = useFindShellController({
      activeTab: ref(undefined),
      settingsOpen,
      splitMenuOpen,
      closeTransientPanels,
      openForTab
    })

    await controller.open()
    await controller.findAgain('next')

    expect(settingsOpen.value).toBe(true)
    expect(splitMenuOpen.value).toBe(true)
    expect(closeTransientPanels).not.toHaveBeenCalled()
    expect(openForTab).not.toHaveBeenCalled()
  })
})

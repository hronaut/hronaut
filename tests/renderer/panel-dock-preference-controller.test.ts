import { describe, expect, it, vi } from 'vitest'
import type { LocalPreferenceStorage } from '../../src/renderer/src/local-preferences.js'
import { usePanelDockPreferenceController } from '../../src/renderer/src/composables/usePanelDockPreferenceController.js'

function storage(initial: Record<string, string> = {}): LocalPreferenceStorage {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
    removeItem: (key) => { values.delete(key) }
  }
}

describe('panel dock preference controller', () => {
  it('restores a valid dock and falls back for invalid or unavailable preferences', () => {
    expect(usePanelDockPreferenceController({
      detachedWindow: false,
      storage: () => storage({ 'hronaut:panel-dock': 'left' })
    }).panelDock.value).toBe('left')
    expect(usePanelDockPreferenceController({
      detachedWindow: false,
      storage: () => storage({ 'hronaut:panel-dock': 'diagonal' })
    }).panelDock.value).toBe('right')
    expect(usePanelDockPreferenceController({
      detachedWindow: false,
      storage: () => { throw new Error('local preferences unavailable') }
    }).panelDock.value).toBe('right')
  })

  it('keeps detached panels separate and does not require local preference storage', () => {
    const getItem = vi.fn(() => 'left')
    const controller = usePanelDockPreferenceController({
      detachedWindow: true,
      storage: () => ({ ...storage(), getItem })
    })

    expect(controller.panelDock.value).toBe('window')
    expect(controller.keepsSeparatePanelOpen()).toBe(true)
    expect(getItem).not.toHaveBeenCalled()
  })

  it('keeps dock changes usable when persistence fails', () => {
    const controller = usePanelDockPreferenceController({
      detachedWindow: false,
      storage: () => ({
        ...storage(),
        setItem: () => { throw new Error('local preferences unavailable') }
      })
    })

    controller.panelDock.value = 'bottom'
    expect(() => controller.persistDock('bottom')).not.toThrow()
    expect(controller.keepsSeparatePanelOpen()).toBe(false)
    controller.panelDock.value = 'window'
    expect(controller.keepsSeparatePanelOpen()).toBe(true)
  })
})

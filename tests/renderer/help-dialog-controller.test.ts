import { describe, expect, it, vi } from 'vitest'
import { useHelpDialogController } from '../../src/renderer/src/composables/useHelpDialogController.js'

describe('help dialog controller', () => {
  it('opens either help view and runs shell cleanup first', () => {
    const beforeOpen = vi.fn()
    const controller = useHelpDialogController({ beforeOpen, translate: (key) => key })

    controller.openDialog('shortcuts')
    expect(controller.dialog.value).toBe('shortcuts')
    expect(controller.open.value).toBe(true)
    controller.openDialog('about')

    expect(controller.dialog.value).toBe('about')
    expect(beforeOpen).toHaveBeenCalledTimes(2)
    controller.dispose()
    expect(controller.open.value).toBe(false)
  })

  it('closes idempotently', () => {
    const controller = useHelpDialogController({ beforeOpen: vi.fn(), translate: (key) => key })
    controller.openDialog('about')

    controller.close()
    controller.close()

    expect(controller.dialog.value).toBeNull()
    controller.dispose()
  })

  it('lists only the keys of its own platform for shortcuts that differ on macOS', () => {
    const keysFor = (platform: string) => {
      const controller = useHelpDialogController({ beforeOpen: vi.fn(), translate: (key) => key, platform })
      const keys = Object.fromEntries(controller.shortcuts.value.map((shortcut) => [shortcut.label, shortcut.keys]))
      return { mac: controller.mac, keys }
    }
    const mac = keysFor('darwin')
    expect(mac.mac).toBe(true)
    expect(mac.keys['runtime.shortcuts.pick']).toEqual(['Cmd', 'Option', 'C'])
    expect(mac.keys['runtime.shortcuts.history']).toEqual(['Cmd', 'Y'])
    expect(mac.keys['runtime.shortcuts.devtools']).toEqual(['Cmd', 'Option', 'I'])
    expect(mac.keys['runtime.shortcuts.back']).toEqual(['Cmd', '['])
    expect(mac.keys['runtime.shortcuts.forward']).toEqual(['Cmd', ']'])
    const linux = keysFor('linux')
    expect(linux.mac).toBe(false)
    expect(linux.keys['runtime.shortcuts.pick']).toEqual(['Ctrl', 'Shift', 'C'])
    expect(linux.keys['runtime.shortcuts.history']).toEqual(['Ctrl', 'H'])
    expect(linux.keys['runtime.shortcuts.devtools']).toEqual(['F12'])
    expect(linux.keys['runtime.shortcuts.back']).toEqual(['Alt', '←'])
    expect(linux.keys['runtime.shortcuts.forward']).toEqual(['Alt', '→'])
    // Every key is one key, so the dialog can write each in its platform's own way.
    for (const keys of Object.values(linux.keys)) for (const key of keys) expect(key === '+' || !/.\+./u.test(key)).toBe(true)
  })

  it('owns the localized keyboard shortcut presentation', () => {
    const controller = useHelpDialogController({
      beforeOpen: vi.fn(),
      translate: (key) => `translated:${key}`
    })

    expect(controller.shortcuts.value).toContainEqual({
      label: 'translated:runtime.shortcuts.nextTab',
      keys: ['Ctrl', 'Tab']
    })
    expect(controller.shortcuts.value).toContainEqual({
      label: 'translated:runtime.shortcuts.reopenTab',
      keys: ['Ctrl/Cmd', 'Shift', 'T']
    })
    expect(controller.shortcuts.value).toContainEqual({
      label: 'translated:runtime.shortcuts.directTab',
      keys: ['Ctrl', '1–8']
    })
    expect(controller.shortcuts.value).toContainEqual({
      label: 'translated:runtime.shortcuts.lastTab',
      keys: ['Ctrl', '9']
    })
    expect(controller.shortcuts.value).toContainEqual({
      label: 'translated:runtime.shortcuts.fullPage',
      keys: ['Ctrl/Cmd', 'Shift', 'F']
    })
    expect(controller.shortcuts.value).toContainEqual({
      label: 'translated:runtime.shortcuts.takeOver',
      keys: ['Ctrl/Cmd', 'Shift', 'O']
    })
    expect(controller.shortcuts.value).toContainEqual({
      label: 'translated:runtime.shortcuts.switchWorkspace',
      keys: ['Ctrl/Cmd', 'K']
    })
    expect(controller.shortcuts.value).toContainEqual({
      label: 'translated:runtime.shortcuts.pinnedWorkspace',
      keys: ['Alt', '1–9']
    })
    expect(controller.shortcuts.value).toHaveLength(26)
    controller.dispose()
  })
})

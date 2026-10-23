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
    expect(mac.keys['runtime.shortcuts.downloads']).toEqual(['Cmd', 'Option', 'L'])
    expect(mac.keys['runtime.shortcuts.devtools']).toEqual(['Cmd', 'Option', 'I'])
    expect(mac.keys['runtime.shortcuts.viewSource']).toEqual(['Cmd', 'Option', 'U'])
    expect(mac.keys['runtime.shortcuts.back']).toEqual(['Cmd', '['])
    expect(mac.keys['runtime.shortcuts.forward']).toEqual(['Cmd', ']'])
    expect(mac.keys['runtime.shortcuts.addressNewTab']).toEqual(['Option', 'Return'])
    expect(mac.keys['runtime.shortcuts.addressBackgroundTab']).toEqual(['Cmd', 'Return'])
    expect(mac.keys['runtime.shortcuts.addressWwwCom']).toEqual(['Control', 'Return'])
    expect(mac.keys['runtime.shortcuts.addressForgetVisit']).toEqual(['Shift', 'Fn', 'Delete'])
    const linux = keysFor('linux')
    expect(linux.mac).toBe(false)
    expect(linux.keys['runtime.shortcuts.pick']).toEqual(['Ctrl', 'Shift', 'C'])
    expect(linux.keys['runtime.shortcuts.history']).toEqual(['Ctrl', 'H'])
    expect(linux.keys['runtime.shortcuts.downloads']).toEqual(['Ctrl', 'J'])
    expect(linux.keys['runtime.shortcuts.devtools']).toEqual(['F12'])
    expect(linux.keys['runtime.shortcuts.back']).toEqual(['Alt', '←'])
    expect(linux.keys['runtime.shortcuts.forward']).toEqual(['Alt', '→'])
    expect(linux.keys['runtime.shortcuts.addressNewTab']).toEqual(['Alt', 'Enter'])
    expect(linux.keys['runtime.shortcuts.addressBackgroundTab']).toEqual(['Alt', 'Shift', 'Enter'])
    expect(linux.keys['runtime.shortcuts.addressWwwCom']).toEqual(['Ctrl', 'Enter'])
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
    // Chrome's keys for the next and previous match of Find.
    expect(controller.shortcuts.value).toContainEqual({
      label: 'translated:runtime.shortcuts.findNext',
      keys: ['Ctrl/Cmd', 'G']
    })
    expect(controller.shortcuts.value).toContainEqual({
      label: 'translated:runtime.shortcuts.findPrevious',
      keys: ['Ctrl/Cmd', 'Shift', 'G']
    })
    expect(controller.shortcuts.value).toContainEqual({
      label: 'translated:runtime.shortcuts.savePage',
      keys: ['Ctrl/Cmd', 'S']
    })
    expect(controller.shortcuts.value).toContainEqual({
      label: 'translated:runtime.shortcuts.print',
      keys: ['Ctrl/Cmd', 'P']
    })
    expect(controller.shortcuts.value).toContainEqual({
      label: 'translated:runtime.shortcuts.addressNewTab',
      keys: ['Alt', 'Enter']
    })
    expect(controller.shortcuts.value).toContainEqual({
      label: 'translated:runtime.shortcuts.viewSource',
      keys: ['Ctrl', 'U']
    })
    expect(controller.shortcuts.value).toContainEqual({
      label: 'translated:runtime.shortcuts.addressForgetVisit',
      keys: ['Shift', 'Delete']
    })
    expect(controller.shortcuts.value).toHaveLength(36)
    controller.dispose()
  })
})

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
      keys: ['Ctrl/Cmd', '1–8']
    })
    expect(controller.shortcuts.value).toContainEqual({
      label: 'translated:runtime.shortcuts.lastTab',
      keys: ['Ctrl/Cmd', '9']
    })
    expect(controller.shortcuts.value).toHaveLength(19)
    controller.dispose()
  })
})

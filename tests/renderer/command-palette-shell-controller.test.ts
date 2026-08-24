import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import {
  type CommandPaletteActions,
  useCommandPaletteShellController
} from '../../src/renderer/src/composables/useCommandPaletteShellController.js'
import { COMMAND_PALETTE_COMMANDS } from '../../src/shared/command-palette.js'

function actions(overrides: Partial<CommandPaletteActions> = {}): CommandPaletteActions {
  const defaults = Object.fromEntries(
    COMMAND_PALETTE_COMMANDS.map(({ id }) => [id, vi.fn()])
  ) as unknown as CommandPaletteActions
  return Object.assign(defaults, overrides)
}

describe('useCommandPaletteShellController', () => {
  it('closes competing shell UI before opening the panel', async () => {
    const open = ref(false)
    const beforeOpen = vi.fn()
    const panel = ref({ openPanel: vi.fn(async () => { open.value = true }), close: vi.fn() })
    const controller = useCommandPaletteShellController({ open, panel, beforeOpen, actions: actions() })

    await controller.toggle()

    expect(beforeOpen).toHaveBeenCalledOnce()
    expect(panel.value.openPanel).toHaveBeenCalledOnce()
    expect(open.value).toBe(true)
  })

  it('closes an open panel without running the opening cleanup', async () => {
    const open = ref(true)
    const beforeOpen = vi.fn()
    const panel = ref({ openPanel: vi.fn(), close: vi.fn() })
    const controller = useCommandPaletteShellController({ open, panel, beforeOpen, actions: actions() })

    await controller.toggle()

    expect(panel.value.close).toHaveBeenCalledOnce()
    expect(beforeOpen).not.toHaveBeenCalled()
    expect(open.value).toBe(false)
  })

  it('closes the palette and dispatches the requested command', async () => {
    const open = ref(true)
    const runHistory = vi.fn()
    const controller = useCommandPaletteShellController({
      open,
      panel: ref(null),
      beforeOpen: vi.fn(),
      actions: actions({ history: runHistory })
    })

    await controller.run('history')

    expect(open.value).toBe(false)
    expect(runHistory).toHaveBeenCalledOnce()
  })

  it('propagates command failures for the palette error reporter', async () => {
    const failure = new Error('shortcut failed')
    const controller = useCommandPaletteShellController({
      open: ref(true),
      panel: ref(null),
      beforeOpen: vi.fn(),
      actions: actions({ reload: vi.fn().mockRejectedValue(failure) })
    })

    await expect(controller.run('reload')).rejects.toBe(failure)
  })
})

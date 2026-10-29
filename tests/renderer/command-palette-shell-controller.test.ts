import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import {
  type CommandPaletteActions,
  useCommandPaletteShellController
} from '../../src/renderer/src/features/command-palette/useCommandPaletteShellController.js'
import { COMMAND_PALETTE_COMMANDS } from '../../src/shared/command-palette.js'

function actions(overrides: Partial<CommandPaletteActions> = {}): CommandPaletteActions {
  const defaults = Object.fromEntries(
    COMMAND_PALETTE_COMMANDS.map(({ id }) => [id, vi.fn()])
  ) as unknown as CommandPaletteActions
  return Object.assign(defaults, overrides)
}

describe('useCommandPaletteShellController', () => {
  it('does not open or clean up competing UI when modal presentation blocks the palette', async () => {
    const open = ref(false)
    const beforeOpen = vi.fn()
    const panel = ref({ openPanel: vi.fn(async () => { open.value = true }), close: vi.fn() })
    const controller = useCommandPaletteShellController({
      open,
      panel,
      canOpen: () => false,
      beforeOpen,
      actions: actions()
    })

    await controller.toggle()

    expect(beforeOpen).not.toHaveBeenCalled()
    expect(panel.value.openPanel).not.toHaveBeenCalled()
    expect(open.value).toBe(false)
  })

  it('closes competing shell UI before opening the panel', async () => {
    const open = ref(false)
    const beforeOpen = vi.fn()
    const panel = ref({ openPanel: vi.fn(async () => { open.value = true }), close: vi.fn() })
    const controller = useCommandPaletteShellController({ open, panel, canOpen: () => true, beforeOpen, actions: actions() })

    await controller.toggle()

    expect(beforeOpen).toHaveBeenCalledOnce()
    expect(panel.value.openPanel).toHaveBeenCalledOnce()
    expect(open.value).toBe(true)
  })

  it('closes an open panel without running the opening cleanup', async () => {
    const open = ref(true)
    const beforeOpen = vi.fn()
    const panel = ref({ openPanel: vi.fn(), close: vi.fn() })
    const controller = useCommandPaletteShellController({ open, panel, canOpen: () => false, beforeOpen, actions: actions() })

    await controller.toggle()

    expect(panel.value.close).toHaveBeenCalledOnce()
    expect(beforeOpen).not.toHaveBeenCalled()
    expect(open.value).toBe(false)
  })

  it('opens on the workspace list, turns between lists while open, and closes on the list it shows', async () => {
    const open = ref(false)
    const view = ref<'commands' | 'workspaces'>('commands')
    const beforeOpen = vi.fn()
    const panel = ref({
      openPanel: vi.fn(async (next: 'commands' | 'workspaces' = 'commands') => { view.value = next; open.value = true }),
      close: vi.fn()
    })
    const controller = useCommandPaletteShellController({ open, view, panel, canOpen: () => true, beforeOpen, actions: actions() })

    await controller.toggle('workspaces')
    expect(panel.value.openPanel).toHaveBeenLastCalledWith('workspaces')
    expect(view.value).toBe('workspaces')

    // Ctrl/Cmd+Shift+P over the switcher shows the commands instead of closing.
    await controller.toggle('commands')
    expect(panel.value.openPanel).toHaveBeenLastCalledWith('commands')
    expect(panel.value.close).not.toHaveBeenCalled()
    expect(open.value).toBe(true)
    expect(beforeOpen).toHaveBeenCalledOnce()

    // An event passed along by a click handler means the commands, which are shown, so the palette closes.
    await controller.toggle(new MouseEvent('click') as never)
    expect(panel.value.close).toHaveBeenCalledOnce()
    expect(open.value).toBe(false)
  })

  it('closes the palette and dispatches the requested command', async () => {
    const open = ref(true)
    const runHistory = vi.fn()
    const controller = useCommandPaletteShellController({
      open,
      panel: ref(null),
      canOpen: () => true,
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
      canOpen: () => true,
      beforeOpen: vi.fn(),
      actions: actions({ reload: vi.fn().mockRejectedValue(failure) })
    })

    await expect(controller.run('reload')).rejects.toBe(failure)
  })
})

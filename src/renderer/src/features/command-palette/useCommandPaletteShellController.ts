import type { Ref } from 'vue'
import type { CommandPaletteCommandId } from '../../../../shared/command-palette.js'

/** The palette lists commands, or workspaces to switch to. */
export type CommandPaletteView = 'commands' | 'workspaces'

export interface CommandPalettePanel {
  openPanel: (view?: CommandPaletteView) => Promise<void>
  close: () => void
}

export type CommandPaletteActions = Record<CommandPaletteCommandId, () => unknown>

export interface CommandPaletteShellControllerOptions<TPanel extends CommandPalettePanel> {
  open: Ref<boolean>
  /** Which list the open palette shows. */
  view?: Readonly<Ref<CommandPaletteView>>
  panel: Readonly<Ref<TPanel | null>>
  canOpen: () => boolean
  beforeOpen: () => void
  actions: CommandPaletteActions
}

export function useCommandPaletteShellController<TPanel extends CommandPalettePanel>(
  options: CommandPaletteShellControllerOptions<TPanel>
) {
  /** Opens the palette on a list, closes it when it already shows that list, or turns it to the other list. */
  async function toggle(requested?: CommandPaletteView): Promise<void> {
    // Handlers can pass an event along; anything but the workspace list means commands.
    const view: CommandPaletteView = requested === 'workspaces' ? 'workspaces' : 'commands'
    if (options.open.value) {
      if ((options.view?.value ?? 'commands') !== view) {
        await options.panel.value?.openPanel(view)
        return
      }
      options.panel.value?.close()
      options.open.value = false
      return
    }
    if (!options.canOpen()) return
    options.beforeOpen()
    await options.panel.value?.openPanel(view)
  }

  async function run(commandId: CommandPaletteCommandId): Promise<void> {
    options.open.value = false
    await options.actions[commandId]()
  }

  return { toggle, run }
}

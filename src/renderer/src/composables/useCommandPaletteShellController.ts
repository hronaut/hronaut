import type { Ref } from 'vue'
import type { CommandPaletteCommandId } from '../../../shared/command-palette.js'

export interface CommandPalettePanel {
  openPanel: () => Promise<void>
  close: () => void
}

export type CommandPaletteActions = Record<CommandPaletteCommandId, () => unknown>

export interface CommandPaletteShellControllerOptions<TPanel extends CommandPalettePanel> {
  open: Ref<boolean>
  panel: Readonly<Ref<TPanel | null>>
  beforeOpen: () => void
  actions: CommandPaletteActions
}

export function useCommandPaletteShellController<TPanel extends CommandPalettePanel>(
  options: CommandPaletteShellControllerOptions<TPanel>
) {
  async function toggle(): Promise<void> {
    if (options.open.value) {
      options.panel.value?.close()
      options.open.value = false
      return
    }
    options.beforeOpen()
    await options.panel.value?.openPanel()
  }

  async function run(commandId: CommandPaletteCommandId): Promise<void> {
    options.open.value = false
    await options.actions[commandId]()
  }

  return { toggle, run }
}

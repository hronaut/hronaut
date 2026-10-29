import type { Ref } from 'vue'
import type { HelpMenuAction } from '../../../shared/types.js'
import type { HelpDialogName } from './useHelpDialogController.js'

export interface HelpShellControllerOptions {
  commandPaletteOpen: Ref<boolean>
  blocked: () => boolean
  closeSettings: () => void
  closeHelpDialog: () => void
  showHelpDialog: (dialog: HelpDialogName) => void
  showSupportSettings: () => void
  showSettings: () => void
  navigate: (url: string) => Promise<unknown>
  openPurchase: () => Promise<unknown>
  runAction: (action: () => unknown) => Promise<boolean>
}

export function useHelpShellController(options: HelpShellControllerOptions) {
  function openDialog(dialog: HelpDialogName): void {
    options.commandPaletteOpen.value = false
    options.closeSettings()
    options.showHelpDialog(dialog)
  }

  function openSettings(show: () => void): void {
    options.commandPaletteOpen.value = false
    options.closeHelpDialog()
    show()
  }

  function openSupportSettings(): void {
    openSettings(options.showSupportSettings)
  }

  function handleRequested(action: HelpMenuAction): void {
    if (options.blocked()) return
    if (action === 'support') {
      openSupportSettings()
      return
    }
    if (action === 'settings') {
      openSettings(options.showSettings)
      return
    }
    openDialog(action)
  }

  async function openUrl(url: string): Promise<void> {
    options.closeHelpDialog()
    options.closeSettings()
    await options.runAction(() => options.navigate(url))
  }

  function purchaseCommercialLicense(): void {
    void options.runAction(options.openPurchase)
  }

  return {
    openDialog,
    openSupportSettings,
    handleRequested,
    openUrl,
    purchaseCommercialLicense
  }
}

export type HelpShellController = ReturnType<typeof useHelpShellController>

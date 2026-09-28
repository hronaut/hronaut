import { nextTick } from 'vue'

export interface SettingsWorkspaceActionsOptions {
  closeSettings: () => void
  openExisting: (workspaceId: string) => Promise<void>
  openNew: () => Promise<void>
  openTransfer: (workspaceId?: string) => Promise<void>
  onError: (error: unknown) => void
}

export function useSettingsWorkspaceActionsController(options: SettingsWorkspaceActionsOptions) {
  async function open(action: () => Promise<void>): Promise<void> {
    options.closeSettings()
    // The editor presentation guard must see that Settings has closed.
    await nextTick()
    try {
      await action()
    } catch (error) {
      options.onError(error)
    }
  }

  return {
    manage: (workspaceId: string) => open(() => options.openExisting(workspaceId)),
    create: () => open(options.openNew),
    transfer: (workspaceId?: string) => open(() => options.openTransfer(workspaceId))
  }
}

import { ref } from 'vue'

export interface WorkspaceEditorShellPanel {
  openExisting: (groupId: string) => Promise<void>
  openNew: () => Promise<void>
  close: () => void
}

export function useWorkspaceEditorShellController() {
  const open = ref(false)
  const panel = ref<WorkspaceEditorShellPanel | null>(null)

  async function openExisting(groupId: string): Promise<void> {
    await panel.value?.openExisting(groupId)
  }

  async function openNew(): Promise<void> {
    await panel.value?.openNew()
  }

  function close(): void {
    panel.value?.close()
  }

  return {
    open,
    panel,
    openExisting,
    openNew,
    close
  }
}

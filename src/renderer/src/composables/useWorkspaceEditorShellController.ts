import { ref, type Ref } from 'vue'

export interface WorkspaceEditorShellPanel {
  openExisting: (groupId: string) => Promise<void>
  openNew: () => Promise<void>
  close: () => void
}

interface WorkspaceEditorShellController<TPanelRef extends Readonly<Ref<WorkspaceEditorShellPanel | null>>> {
  open: Ref<boolean>
  panel: TPanelRef
  openExisting: (groupId: string) => Promise<void>
  openNew: () => Promise<void>
  close: () => void
}

export function useWorkspaceEditorShellController(): WorkspaceEditorShellController<Ref<WorkspaceEditorShellPanel | null>>
export function useWorkspaceEditorShellController(
  panel: Readonly<Ref<WorkspaceEditorShellPanel | null>>
): WorkspaceEditorShellController<Readonly<Ref<WorkspaceEditorShellPanel | null>>>
export function useWorkspaceEditorShellController(
  externalPanel?: Readonly<Ref<WorkspaceEditorShellPanel | null>>
): WorkspaceEditorShellController<Readonly<Ref<WorkspaceEditorShellPanel | null>>> {
  const open = ref(false)
  const panel = externalPanel ?? ref<WorkspaceEditorShellPanel | null>(null)

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

import { computed, ref } from 'vue'
import type { BrowserTabState } from '../../../shared/types.js'
import { useWorkspaceEditorShellController } from './useWorkspaceEditorShellController.js'

type ZoomAction = 'in' | 'out' | 'reset'

export interface AppTransientShellSurface {
  openTabSearch: () => Promise<void>
  closeTabSearch: () => void
  openFindForTab: (tab: BrowserTabState) => Promise<void>
  closeFind: () => Promise<void>
  openZoomForTab: (tab: BrowserTabState) => Promise<void>
  closeZoom: () => void
  setZoom: (action: ZoomAction) => Promise<void>
  openWorkspace: (groupId: string) => Promise<void>
  openNewWorkspace: () => Promise<void>
  closeWorkspace: () => void
  openCredentialPicker: () => Promise<void>
  closeCredentialPicker: () => void
  openCommandPalette: () => Promise<void>
  closeCommandPalette: () => void
}

export function useAppTransientShellLayerController() {
  const layer = ref<AppTransientShellSurface | null>(null)
  const credentialPickerOpen = ref(false)
  const findOpen = ref(false)
  const zoomOpen = ref(false)
  const tabSearchOpen = ref(false)
  const commandPaletteOpen = ref(false)

  const tabSearchPanel = computed(() => {
    const surface = layer.value
    return surface ? { openPanel: surface.openTabSearch, close: surface.closeTabSearch } : null
  })
  const zoomBar = computed(() => {
    const surface = layer.value
    return surface ? {
      openForTab: surface.openZoomForTab,
      close: surface.closeZoom,
      setZoom: surface.setZoom
    } : null
  })
  const workspaceEditorPanel = computed(() => {
    const surface = layer.value
    return surface ? {
      openExisting: surface.openWorkspace,
      openNew: surface.openNewWorkspace,
      close: surface.closeWorkspace
    } : null
  })
  const commandPalettePanel = computed(() => {
    const surface = layer.value
    return surface ? { openPanel: surface.openCommandPalette, close: surface.closeCommandPalette } : null
  })
  const workspaceEditorController = useWorkspaceEditorShellController(workspaceEditorPanel)

  async function openFindForTab(tab: BrowserTabState): Promise<void> {
    await layer.value?.openFindForTab(tab)
  }

  async function closeFind(): Promise<void> {
    await layer.value?.closeFind()
  }

  async function openCredentialPicker(): Promise<void> {
    await layer.value?.openCredentialPicker()
  }

  async function setZoom(action: ZoomAction): Promise<void> {
    await layer.value?.setZoom(action)
  }

  return {
    layer,
    credentialPickerOpen,
    findOpen,
    zoomOpen,
    tabSearchOpen,
    commandPaletteOpen,
    tabSearchPanel,
    zoomBar,
    commandPalettePanel,
    workspaceEditorOpen: workspaceEditorController.open,
    openWorkspace: workspaceEditorController.openExisting,
    openNewWorkspace: workspaceEditorController.openNew,
    closeWorkspace: workspaceEditorController.close,
    openFindForTab,
    closeFind,
    openCredentialPicker,
    setZoom
  }
}

export type AppTransientShellLayerController = ReturnType<typeof useAppTransientShellLayerController>

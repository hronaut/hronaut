import { ref, type Ref } from 'vue'
import type { BrowserTabState } from '../../../shared/types.js'

interface TabDragReorderOptions {
  /** The tabs that can move. A tab moves only among tabs with its own pin state and workspace. */
  tabs: Readonly<Ref<readonly BrowserTabState[]>>
  vertical: Readonly<Ref<boolean>>
  onDragStart: () => void
  onReorder: (details: { tabId: string; targetTabId: string; placement: 'before' | 'after' }) => void
}

/** Dragging a tab to a new place: the tab being dragged, where it would land, and the move it asks for on drop. */
export function useTabDragReorder(options: TabDragReorderOptions) {
  const { tabs: regularTabs, vertical } = options
  const draggedTabId = ref<string | null>(null)
  const tabDropTargetId = ref<string | null>(null)
  const tabDropPlacement = ref<'before' | 'after' | null>(null)

  function clearTabDrag(): void {
    draggedTabId.value = null
    tabDropTargetId.value = null
    tabDropPlacement.value = null
  }

  function canDropTab(target: BrowserTabState): boolean {
    const dragged = regularTabs.value.find((tab) => tab.id === draggedTabId.value)
    return Boolean(
      dragged
      && dragged.id !== target.id
      && dragged.pinned === target.pinned
      && dragged.mcpGroupId === target.mcpGroupId
    )
  }

  function beginTabDrag(event: DragEvent, tab: BrowserTabState): void {
    draggedTabId.value = tab.id
    tabDropTargetId.value = null
    tabDropPlacement.value = null
    options.onDragStart()
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', tab.id)
    }
  }

  function updateTabDrop(event: DragEvent, tab: BrowserTabState): void {
    if (!canDropTab(tab)) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect()
    tabDropTargetId.value = tab.id
    tabDropPlacement.value = vertical.value
      ? event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
      : event.clientX < bounds.left + bounds.width / 2 ? 'before' : 'after'
  }

  function finishTabDrop(event: DragEvent, tab: BrowserTabState): void {
    if (!canDropTab(tab) || !draggedTabId.value || !tabDropPlacement.value) {
      clearTabDrag()
      return
    }
    event.preventDefault()
    const details = {
      tabId: draggedTabId.value,
      targetTabId: tab.id,
      placement: tabDropPlacement.value
    }
    clearTabDrag()
    options.onReorder(details)
  }

  return { draggedTabId, tabDropTargetId, tabDropPlacement, clearTabDrag, beginTabDrag, updateTabDrop, finishTabDrop }
}

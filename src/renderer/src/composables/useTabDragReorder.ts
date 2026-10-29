import { ref, type Ref } from 'vue'
import type { BrowserTabState } from '../../../shared/types.js'

interface TabDragReorderOptions {
  /** The tabs that can move. A tab moves only among tabs with its own pin state and workspace. */
  tabs: Readonly<Ref<readonly BrowserTabState[]>>
  vertical: Readonly<Ref<boolean>>
  /** The selected tabs a drag of this tab moves with it, as in Chrome: every one when it is selected, else none. */
  selectionWith?: (tabId: string) => readonly string[]
  onDragStart: () => void
  /** The move asked for on drop, with every tab it moves in tabIds when it moves several. */
  onReorder: (details: { tabId: string; targetTabId: string; placement: 'before' | 'after'; tabIds?: string[] }) => void
}

/** The type a tab's own drag carries, so a tab dragged from either copy of the rail is never read as a dropped link. */
export const TAB_DRAG_TYPE = 'application/x-hronaut-tab'

/** Dragging a tab to a new place: the tab being dragged, where it would land, and the move it asks for on drop. */
export function useTabDragReorder(options: TabDragReorderOptions) {
  const { tabs: regularTabs, vertical } = options
  const draggedTabId = ref<string | null>(null)
  /** The tabs the drag moves: the dragged one, and the selected tabs of its workspace and pin state with it. */
  const draggedTabIds = ref<string[]>([])
  const tabDropTargetId = ref<string | null>(null)
  const tabDropPlacement = ref<'before' | 'after' | null>(null)

  function clearTabDrag(): void {
    draggedTabId.value = null
    draggedTabIds.value = []
    tabDropTargetId.value = null
    tabDropPlacement.value = null
  }

  function canDropTab(target: BrowserTabState): boolean {
    const dragged = regularTabs.value.find((tab) => tab.id === draggedTabId.value)
    return Boolean(
      dragged
      && !draggedTabIds.value.includes(target.id)
      && dragged.pinned === target.pinned
      && dragged.mcpGroupId === target.mcpGroupId
    )
  }

  function beginTabDrag(event: DragEvent, tab: BrowserTabState): void {
    const selected = new Set(options.selectionWith?.(tab.id))
    draggedTabId.value = tab.id
    draggedTabIds.value = selected.size
      ? regularTabs.value.filter((candidate) => (
          selected.has(candidate.id) && candidate.pinned === tab.pinned && candidate.mcpGroupId === tab.mcpGroupId
        )).map((candidate) => candidate.id)
      : [tab.id]
    tabDropTargetId.value = null
    tabDropPlacement.value = null
    options.onDragStart()
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', tab.id)
      event.dataTransfer.setData(TAB_DRAG_TYPE, tab.id)
    }
  }

  function updateTabDrop(event: DragEvent, tab: BrowserTabState): void {
    if (!canDropTab(tab)) {
      // Over a tab it cannot land beside, such as itself, the marker beside the last tab it could leaves too.
      tabDropTargetId.value = null
      tabDropPlacement.value = null
      return
    }
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
      placement: tabDropPlacement.value,
      ...(draggedTabIds.value.length > 1 ? { tabIds: [...draggedTabIds.value] } : {})
    }
    clearTabDrag()
    options.onReorder(details)
  }

  return { draggedTabId, draggedTabIds, tabDropTargetId, tabDropPlacement, clearTabDrag, beginTabDrag, updateTabDrop, finishTabDrop }
}

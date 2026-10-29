import { ref, type Ref } from 'vue'
import type { BrowserTabState, DroppedLinkTarget } from '../../../shared/types.js'
import { TAB_DRAG_TYPE } from './useTabDragReorder.js'

/** Where a link opens from a tab it is over: the middle half opens it in the tab, either edge in a new tab on that side. */
export type TabLinkDropPlacement = 'onto' | 'before' | 'after'

interface TabLinkDropOptions {
  vertical: Readonly<Ref<boolean>>
  /** Whether this bar takes dropped links; the copy main draws over the page does not. */
  accepts: () => boolean
  /** A tab of this bar is being dragged, which is a move, not a link. */
  draggingTab: () => boolean
  onDrop: (details: { text: string; target: DroppedLinkTarget }) => void
}

/**
 * A link, or other text, dragged over the tab strip or rail from a page or another app, as in Chrome (TabStrip's drop
 * handling): dropped on a tab it opens in that tab, near either edge of the tab in a new tab on that side, and on a
 * workspace's New tab button in a new tab at the end of that workspace. A file dragged from the computer and the bar's
 * own tabs are no links; an image dragged from a page, which carries its picture as a file too, opens its address.
 */
export function useTabLinkDrop(options: TabLinkDropOptions) {
  const linkDropTabId = ref<string | null>(null)
  const linkDropPlacement = ref<TabLinkDropPlacement | null>(null)
  /** The workspace whose New tab button a link is over; '' for the button of a strip with no workspace. */
  const linkDropWorkspaceId = ref<string | null>(null)

  function carriesLink(event: DragEvent): boolean {
    const types = [...(event.dataTransfer?.types ?? [])]
    return options.accepts()
      && !options.draggingTab()
      && !types.includes(TAB_DRAG_TYPE)
      && (types.includes('text/uri-list') || (types.includes('text/plain') && !types.includes('Files')))
  }

  function clearLinkDrop(): void {
    linkDropTabId.value = null
    linkDropPlacement.value = null
    linkDropWorkspaceId.value = null
  }

  // As in Chrome, a quarter of the tab at either edge is beside it, and the rest is on it.
  function placementOver(event: DragEvent): TabLinkDropPlacement {
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const [position, start, size] = options.vertical.value
      ? [event.clientY, bounds.top, bounds.height]
      : [event.clientX, bounds.left, bounds.width]
    if (position < start + size / 4) return 'before'
    if (position >= start + size - size / 4) return 'after'
    return 'onto'
  }

  // The pointer entering a tab or button decides, as moving over it does, whether a release there drops.
  function accept(event: DragEvent): void {
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = dropEffect(event.dataTransfer.effectAllowed)
  }

  // How many of the strip's elements the drag is in, from the dragenter and dragleave events that reach the strip.
  // Chromium names no element a drag leaves for, so this tells leaving the strip from moving between its elements,
  // where the element entered fires before the one left.
  let depth = 0

  /** The drag entered an element of the strip; one that takes no link, such as the space between tabs, shows none. */
  function enterStrip(event: DragEvent): void {
    depth += 1
    if (!event.defaultPrevented) clearLinkDrop()
  }

  function overStrip(event: DragEvent): void {
    if (!event.defaultPrevented) clearLinkDrop()
  }

  /** The drag left an element of the strip; the marker goes once it has left the strip. */
  function leaveStrip(): void {
    depth = Math.max(0, depth - 1)
    if (depth === 0) clearLinkDrop()
  }

  /** The drag ended in the strip, with a drop or the end of a tab's own drag, which no dragleave follows. */
  function endStripDrag(): void {
    depth = 0
    clearLinkDrop()
  }

  /** Shows where a link over the tab would open; false when the drag carries no link. */
  function overTab(event: DragEvent, tab: BrowserTabState): boolean {
    if (!carriesLink(event)) return false
    accept(event)
    linkDropWorkspaceId.value = null
    linkDropTabId.value = tab.id
    linkDropPlacement.value = placementOver(event)
    return true
  }

  /** Opens a link dropped on the tab; false when the drag carries no link. */
  function dropOnTab(event: DragEvent, tab: BrowserTabState): boolean {
    if (!carriesLink(event)) return false
    event.preventDefault()
    const placement = placementOver(event)
    const text = droppedText(event)
    clearLinkDrop()
    if (text) options.onDrop({ text, target: { tabId: tab.id, placement } })
    return true
  }

  function overNewTab(event: DragEvent, workspaceId?: string): void {
    if (!carriesLink(event)) return
    accept(event)
    linkDropTabId.value = null
    linkDropPlacement.value = null
    linkDropWorkspaceId.value = workspaceId ?? ''
  }

  function dropOnNewTab(event: DragEvent, workspaceId?: string): void {
    if (!carriesLink(event)) return
    event.preventDefault()
    const text = droppedText(event)
    clearLinkDrop()
    if (text) options.onDrop({ text, target: workspaceId === undefined ? {} : { workspaceId } })
  }

  return { linkDropTabId, linkDropPlacement, linkDropWorkspaceId, enterStrip, overStrip, leaveStrip, endStripDrag, overTab, dropOnTab, overNewTab, dropOnNewTab }
}

/** As Chrome's tab strip takes a drop: a copy when the source allows one, else a link, else a move. */
function dropEffect(allowed: DataTransfer['effectAllowed']): 'copy' | 'link' | 'move' {
  if (['copy', 'copyLink', 'copyMove', 'all', 'uninitialized'].includes(allowed)) return 'copy'
  return allowed === 'link' || allowed === 'linkMove' ? 'link' : 'move'
}

/** The first address of a dragged link, or the dragged text; a file on the computer opens nothing. */
function droppedText(event: DragEvent): string {
  const data = event.dataTransfer
  if (!data) return ''
  const address = data.getData('text/uri-list').split(/\r?\n/u).map((line) => line.trim()).find((line) => line && !line.startsWith('#'))
  if (address !== undefined) return /^file:/iu.test(address) ? '' : address
  return data.getData('text/plain')
}

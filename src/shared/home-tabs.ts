import type { BrowserTabGroupColor } from './types.js'
import type { EmulationSummary } from './emulation-description.js'

/** An open website tab as Home's Tabs view shows it: what its card says, without diagnostics or page contents. */
export interface HomeTab {
  id: string
  /** Its workspace; a tab outside one is listed under Other tabs. */
  workspaceId?: string
  title: string
  label?: string
  url: string
  faviconDataUrl?: string
  loading: boolean
  sleeping: boolean
  /** Its label was kept in memory but may not be on disk yet. */
  labelDurabilityUnconfirmed?: boolean
  pinned: boolean
  muted: boolean
  audible: boolean
  /** Whether the person's input to its page is locked. */
  locked: boolean
  /** Whether an agent's call runs in it now. */
  agentActive: boolean
  emulation?: EmulationSummary
  networkRouteCount?: number
  /** Advances with each navigation, so a preview of an earlier page is not shown for it. */
  navigationGeneration: number
  /** The revision of the tab's stored frame, when main has one; Home asks again for a frame whose revision changed. */
  previewRevision?: number
}

export interface HomeTabsWorkspace {
  id: string
  name: string
  color: BrowserTabGroupColor
}

/** A tab closed recently, which Home can open again in its place. */
export interface HomeClosedTab {
  id: string
  title: string
  label?: string
  url: string
  pinned: boolean
  closedAt: string
}

/** An archived workspace, which Home can restore or delete. */
export interface HomeArchivedWorkspace {
  id: string
  name: string
  color: BrowserTabGroupColor
  deletionProtected: boolean
  tabs: Array<{ title: string; label?: string; url: string }>
}

/** Everything Home's Tabs view lists, read again on each change. */
export interface HomeTabsState {
  workspaces: HomeTabsWorkspace[]
  /** The open website tabs in the order the tab strip shows them; Home's own tabs are left out. */
  tabs: HomeTab[]
  /** The page shown before Home, which Escape goes back to and its card marks as the current tab; null when gone. */
  previousTabId: string | null
  closedTabs: HomeClosedTab[]
  archivedWorkspaces: HomeArchivedWorkspace[]
  /** Whether the person's input to the whole browser is locked, which keeps archived workspaces from deletion. */
  locked: boolean
}

/** What Home's Tabs view asks main to do; main answers with the tabs as they are after it. */
export type HomeTabAction =
  | { kind: 'open' | 'close'; tabId: string }
  | { kind: 'pin'; tabId: string; pinned: boolean }
  | { kind: 'label'; tabId: string; label: string }
  | { kind: 'reopen'; closedTabId: string }
  | { kind: 'restore' | 'delete'; workspaceId: string }
  /** Shows the page shown before Home again, when it is still open. */
  | { kind: 'back' }
  | { kind: 'new-tab' }

/** The view Home shows when main asks it to show its tabs, with the search field focused. */
export const HOME_TABS_VIEW = 'tabs'

/** Checks a Tabs view action that came over IPC; throws on anything else. */
export function validHomeTabAction(value: unknown): HomeTabAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid tab action')
  const action = value as Record<string, unknown>
  const id = (key: string): string => {
    const candidate = action[key]
    if (typeof candidate !== 'string' || !candidate || candidate.length > 256) throw new TypeError('Invalid tab action')
    return candidate
  }
  switch (action.kind) {
    case 'open':
    case 'close': return { kind: action.kind, tabId: id('tabId') }
    case 'pin':
      if (typeof action.pinned !== 'boolean') throw new TypeError('Invalid tab action')
      return { kind: 'pin', tabId: id('tabId'), pinned: action.pinned }
    case 'label':
      if (typeof action.label !== 'string') throw new TypeError('Invalid tab action')
      return { kind: 'label', tabId: id('tabId'), label: action.label }
    case 'reopen': return { kind: 'reopen', closedTabId: id('closedTabId') }
    case 'restore':
    case 'delete': return { kind: action.kind, workspaceId: id('workspaceId') }
    case 'back':
    case 'new-tab': return { kind: action.kind }
    default: throw new TypeError('Invalid tab action')
  }
}

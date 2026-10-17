import type { BrowserState } from './types.js'

/** How many of a workspace's tabs its Home card shows, with their icons. */
export const HOME_CARD_TAB_LIMIT = 4
/** The longest icon, as a data URL, Home is sent; larger ones show the site's initial instead. */
export const HOME_CARD_ICON_MAX_LENGTH = 16 * 1024

export type HomeWorkspaceState = Pick<BrowserState, 'mcpTabGroups' | 'savedTabGroups' | 'activeTabId' | 'allHumanInteractionLocked'> & { tabs: Array<Pick<BrowserState['tabs'][number], 'id' | 'mcpGroupId' | 'title' | 'url' | 'faviconDataUrl'>> }
export type HomeWorkspaceEditorRequest = { view: 'import'; workspaceId: string } | { view: 'create' } | { view: 'templates' } | { view: 'edit'; workspaceId: string } | { view: 'transfer'; workspaceId: string }
export type HomeWorkspaceAction = Exclude<HomeWorkspaceEditorRequest, { view: 'import' }>
  | { view: 'open' | 'archive' | 'restore' | 'delete'; workspaceId: string }
  /** Undoable unless the archive is full, when Home asks first and it is deleted at once. */
  | { view: 'clear'; workspaceId: string; undoable?: boolean }
  | { view: 'preferences'; workspaceId: string; hiddenFromSidebar?: boolean; deletionProtected?: boolean }

import type { BrowserState } from './types.js'

export type HomeWorkspaceState = Pick<BrowserState, 'mcpTabGroups' | 'savedTabGroups' | 'activeTabId' | 'allHumanInteractionLocked'> & { tabs: Array<Pick<BrowserState['tabs'][number], 'id' | 'mcpGroupId' | 'title' | 'url'>> }
export type HomeWorkspaceEditorRequest = { view: 'create' } | { view: 'templates' } | { view: 'edit'; workspaceId: string } | { view: 'transfer'; workspaceId: string }
export type HomeWorkspaceAction = HomeWorkspaceEditorRequest
  | { view: 'open' | 'archive' | 'restore' | 'delete'; workspaceId: string }
  | { view: 'preferences'; workspaceId: string; hiddenFromSidebar?: boolean; deletionProtected?: boolean }

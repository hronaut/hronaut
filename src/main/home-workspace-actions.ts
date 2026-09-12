import type { BrowserTabsManager } from './browser/tabs-manager.js'
import type { HomeWorkspaceAction, HomeWorkspaceEditorRequest, HomeWorkspaceState } from '../shared/home-workspaces.js'

export function homeWorkspaceState(manager: Pick<BrowserTabsManager, 'getState'>): HomeWorkspaceState {
  const state = manager.getState()
  return {
    activeTabId: state.activeTabId,
    allHumanInteractionLocked: state.allHumanInteractionLocked,
    mcpTabGroups: state.mcpTabGroups,
    savedTabGroups: state.savedTabGroups,
    // Home needs page labels for search, without diagnostics or page contents.
    tabs: state.tabs.map(tab => ({ id: tab.id, mcpGroupId: tab.mcpGroupId, title: tab.title, url: tab.url }))
  }
}

export async function runHomeWorkspaceAction(
  manager: Pick<BrowserTabsManager, 'getState' | 'openHome' | 'selectTab' | 'newTab' | 'saveAndCloseTabGroup' | 'restoreSavedTabGroup' | 'deleteSavedTabGroup' | 'updateMcpTabGroup' | 'updateArchivedWorkspacePreferences'>,
  input: unknown,
  edit: (request: HomeWorkspaceEditorRequest) => void
): Promise<HomeWorkspaceState> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Invalid workspace action')
  const request = input as HomeWorkspaceAction
  const state = manager.getState()
  if (request.view === 'create' || request.view === 'templates') {
    edit({ view: request.view })
    return homeWorkspaceState(manager)
  }
  if (!('workspaceId' in request) || typeof request.workspaceId !== 'string') throw new TypeError('Invalid workspace action')
  const active = state.mcpTabGroups.find(group => group.id === request.workspaceId)
  const archived = state.savedTabGroups.find(group => group.id === request.workspaceId)
  if (!active && !archived) throw new Error('Workspace is no longer available.')
  switch (request.view) {
    case 'edit':
      if (!active) throw new Error('Restore this workspace to edit its settings.')
      edit({ view: 'edit', workspaceId: request.workspaceId })
      break
    case 'transfer': edit({ view: 'transfer', workspaceId: request.workspaceId }); break
    case 'open':
    case 'restore':
      if (archived) await manager.restoreSavedTabGroup(archived.id)
      else if (active) {
        const tabId = active.activeTabId ?? state.tabs.find(tab => tab.mcpGroupId === active.id)?.id
        if (tabId) manager.selectTab(tabId)
        else await manager.newTab({ mcpGroupId: active.id, active: true })
      }
      if (request.view === 'restore') await manager.openHome()
      break
    case 'archive':
      if (state.allHumanInteractionLocked) throw new Error('Unlock the browser before archiving a workspace.')
      await manager.saveAndCloseTabGroup(request.workspaceId)
      break
    case 'delete':
      if (state.allHumanInteractionLocked) throw new Error('Unlock the browser before deleting a workspace.')
      await manager.deleteSavedTabGroup(request.workspaceId)
      break
    case 'preferences': {
      const updates: { hiddenFromSidebar?: boolean; deletionProtected?: boolean } = {}
      for (const key of ['hiddenFromSidebar', 'deletionProtected'] as const) {
        if (request[key] !== undefined) {
          if (typeof request[key] !== 'boolean') throw new TypeError('Invalid workspace preference')
          updates[key] = request[key]
        }
      }
      if (!Object.keys(updates).length) throw new TypeError('Choose a workspace preference')
      if (active) manager.updateMcpTabGroup(active.id, updates)
      else manager.updateArchivedWorkspacePreferences(request.workspaceId, updates)
      break
    }
    default: throw new TypeError('Invalid workspace action')
  }
  return homeWorkspaceState(manager)
}

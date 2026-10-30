import { BROWSER_IMPORT_IPC } from '../../shared/ipc/browser-import.js'
import { WORKSPACES_IPC } from '../../shared/ipc/workspaces.js'
import type { HronautWorkspacesApi } from '../../shared/types.js'
import { invoke } from './ipc.js'

/** window.hronaut's workspaces, their templates, data, navigation policy and continuity, and browser import. */
export const workspacesApi: HronautWorkspacesApi = {
  createWorkspace: (options) => invoke(WORKSPACES_IPC.create, options),
  openWorkspaceTemplateFile: () => invoke(WORKSPACES_IPC.openTemplateFile),
  saveWorkspaceTemplateFile: (reviewedText) => invoke(WORKSPACES_IPC.saveTemplateFile, reviewedText),
  importWorkspaceTemplate: (text) => invoke(WORKSPACES_IPC.importTemplate, text),
  renameTabGroup: (groupId, name) => invoke(WORKSPACES_IPC.rename, groupId, name),
  updateTabGroup: (groupId, updates) => invoke(WORKSPACES_IPC.update, groupId, updates),
  reviewWorkspaceContinuity: (workspaceId) => invoke(WORKSPACES_IPC.reviewContinuity, workspaceId),
  listHumanWaiting: (workspaceId) => invoke(WORKSPACES_IPC.listHumanWaiting, workspaceId),
  changeHumanWaiting: (workspaceId, id, revision, action, confirmation, note) =>
    invoke(WORKSPACES_IPC.changeHumanWaiting, workspaceId, id, revision, action, confirmation, note),
  checkpointWorkspaceContinuity: (workspaceId, markerSelector) => invoke(WORKSPACES_IPC.checkpointContinuity, workspaceId, markerSelector),
  reconcileWorkspaceContinuity: (workspaceId, reviewId, acknowledge) => invoke(WORKSPACES_IPC.reconcileContinuity, workspaceId, reviewId, acknowledge),
  updateWorkspaceNavigationPolicy: (groupId, policy) => invoke(WORKSPACES_IPC.updateNavigationPolicy, groupId, policy),
  listWorkspaceNavigationAudit: (groupId) => invoke(WORKSPACES_IPC.listNavigationAudit, groupId),
  listWorkspaceStorageOrigins: (workspaceId) => invoke(WORKSPACES_IPC.listStorageOrigins, workspaceId),
  transferWorkspaceStorage: (options) => invoke(WORKSPACES_IPC.transferStorage, options),
  closeWorkspace: (workspaceId, options) => invoke(WORKSPACES_IPC.close, workspaceId, options),
  saveAndCloseTabGroup: (groupId) => invoke(WORKSPACES_IPC.saveAndClose, groupId),
  restoreSavedTabGroup: (savedGroupId) => invoke(WORKSPACES_IPC.restoreSaved, savedGroupId),
  deleteSavedTabGroup: (savedGroupId) => invoke(WORKSPACES_IPC.deleteSaved, savedGroupId),
  showWorkspaceContextMenu: (workspaceId) => invoke(WORKSPACES_IPC.showContextMenu, workspaceId),
  browserImport: {
    list: (workspaceId) => invoke(BROWSER_IMPORT_IPC.list, workspaceId),
    preview: (workspaceId, profileId) => invoke(BROWSER_IMPORT_IPC.preview, workspaceId, profileId),
    commit: (previewId, domains) => invoke(BROWSER_IMPORT_IPC.commit, previewId, domains),
    cancel: () => invoke(BROWSER_IMPORT_IPC.cancel)
  }
}

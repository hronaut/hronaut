import type { HumanWaitingRecord, HumanWaitingTrustedConfirmation } from '../human-waiting.js'
import type {
  BrowserState,
  BrowserTabGroupUpdate,
  BrowserWorkspaceCreateOptions,
  BrowserWorkspaceNavigationAuditEntry,
  BrowserWorkspaceNavigationPolicy,
  BrowserWorkspaceStorageTransferOptions,
  BrowserWorkspaceStorageTransferResult
} from '../types.js'
import type { WorkspaceContinuityReport } from '../workspace-continuity.js'
import type { WorkspaceTemplateImportResult } from '../workspace-template.js'
import type { InvokeChannel } from './channel.js'

/** Workspaces: making, editing, archiving and closing them, their templates, data, navigation policy, continuity and the decisions agents ask the person for in them. */
export const WORKSPACES_IPC = {
  /** Shell → main: makes a workspace, starting empty or with a copy of another workspace's data. */
  create: 'browser:create-workspace' as InvokeChannel<[options: BrowserWorkspaceCreateOptions], BrowserState>,
  /** Shell → main: reads a template file the person picks; null when they picked none. */
  openTemplateFile: 'browser:open-workspace-template-file' as InvokeChannel<[], string | null>,
  /** Shell → main: saves the reviewed template text to a file the person picks; false when they picked none. */
  saveTemplateFile: 'browser:save-workspace-template-file' as InvokeChannel<[reviewedText: string], boolean>,
  /** Shell → main: makes the workspaces a template describes. */
  importTemplate: 'browser:import-workspace-template' as InvokeChannel<[text: string], WorkspaceTemplateImportResult & { state: BrowserState }>,
  /** Shell → main: renames the workspace. */
  rename: 'browser:rename-tab-group' as InvokeChannel<[groupId: string, name: string], BrowserState>,
  /** Shell → main: changes the workspace's name, description, color, preferences or agent access. */
  update: 'browser:update-tab-group' as InvokeChannel<[groupId: string, updates: BrowserTabGroupUpdate], BrowserState>,
  /** Shell → main: compares the workspace's continuity checkpoint with its page now. */
  reviewContinuity: 'browser:review-workspace-continuity' as InvokeChannel<[workspaceId: string], WorkspaceContinuityReport>,
  /** Shell → main: the decisions agents asked the person for in the workspace, still open or answered, with the person's answers. */
  listHumanWaiting: 'browser:list-human-waiting' as InvokeChannel<[workspaceId: string], HumanWaitingRecord[]>,
  /** Shell → main: the person acknowledges, cancels, rejects or resolves a decision an agent waits on, at the revision they saw. */
  changeHumanWaiting: 'browser:change-human-waiting' as InvokeChannel<[
    workspaceId: string,
    id: string,
    revision: string,
    action: 'acknowledge' | 'cancel' | 'reject' | 'resolve',
    confirmation: HumanWaitingTrustedConfirmation | undefined,
    note: string | undefined
  ], HumanWaitingRecord>,
  /** Shell → main: saves a continuity checkpoint of the workspace's page, with an optional page marker, and answers the comparison after. */
  checkpointContinuity: 'browser:checkpoint-workspace-continuity' as InvokeChannel<[workspaceId: string, markerSelector: string | undefined], WorkspaceContinuityReport>,
  /** Shell → main: resumes the workspace's suspended checkpoint from this review, and answers the comparison after. */
  reconcileContinuity: 'browser:reconcile-workspace-continuity' as InvokeChannel<[workspaceId: string, reviewId: string, acknowledgeUnknownOutcome: boolean], WorkspaceContinuityReport>,
  /** Shell → main: sets where the workspace's tabs may go. */
  updateNavigationPolicy: 'browser:update-workspace-navigation-policy' as InvokeChannel<[groupId: string, policy: BrowserWorkspaceNavigationPolicy], BrowserState>,
  /** Shell → main: the navigations the workspace's policy refused. */
  listNavigationAudit: 'browser:list-workspace-navigation-audit' as InvokeChannel<[groupId: string], BrowserWorkspaceNavigationAuditEntry[]>,
  /** Shell → main: the origins the workspace keeps data for. */
  listStorageOrigins: 'browser:list-workspace-storage-origins' as InvokeChannel<[workspaceId: string], string[]>,
  /** Shell → main: copies or moves site data from one workspace to another. */
  transferStorage: 'browser:transfer-workspace-storage' as InvokeChannel<[options: BrowserWorkspaceStorageTransferOptions], BrowserWorkspaceStorageTransferResult>,
  /** Shell → main: closes the workspace and deletes its data; undoable, it is archived until Undo is no longer offered. */
  close: 'browser:close-workspace' as InvokeChannel<[workspaceId: string, options: { undoable?: boolean } | undefined], BrowserState>,
  /** Shell → main: archives the workspace and closes its tabs. */
  saveAndClose: 'browser:save-and-close-tab-group' as InvokeChannel<[groupId: string], BrowserState>,
  /** Shell → main: opens an archived workspace again. */
  restoreSaved: 'browser:restore-saved-tab-group' as InvokeChannel<[savedGroupId: string], BrowserState>,
  /** Shell → main: deletes an archived workspace. */
  deleteSaved: 'browser:delete-saved-tab-group' as InvokeChannel<[savedGroupId: string], BrowserState>,
  /** Shell → main: shows the workspace's menu. */
  showContextMenu: 'browser:show-workspace-context-menu' as InvokeChannel<[workspaceId: string], void>
} as const

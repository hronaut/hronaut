import type {
  BrowserWindow,
  IpcMain,
  IpcMainInvokeEvent,
  OpenDialogOptions,
  OpenDialogReturnValue,
  SaveDialogOptions,
  SaveDialogReturnValue
} from 'electron'
import type { BrowserTabsManager } from './browser/tabs-manager.js'
import { normalizeWorkspaceNavigationPolicy } from './browser/workspace-navigation-policy.js'
import { LocalizedError } from './localized-error.js'
import { agentAnswerForDecision } from './mcp/agent-presence.js'
import type { HumanWaitingService } from './mcp/human-waiting-service.js'
import type { McpHttpServer } from './mcp/server.js'
import { readWorkspaceTemplateFile, writeWorkspaceTemplateFile } from './workspace-template-file.js'
import { humanWaitingDecisionOpen, normalizeHumanWaitingNote } from '../shared/human-waiting.js'
import type { MessageKey, MessageParameters } from '../shared/i18n.js'
import { isBrowserTabGroupColor } from '../shared/tab-groups.js'
import type {
  BrowserTabGroupUpdate,
  BrowserWorkspaceCreateOptions,
  BrowserWorkspaceStorageTransferOptions,
  UserAttentionRequest
} from '../shared/types.js'
import { parseWorkspaceTemplate, WORKSPACE_TEMPLATE_ERRORS } from '../shared/workspace-template.js'

type WorkspacesIpcTabs = Pick<BrowserTabsManager,
  | 'getState' | 'renameMcpTabGroup' | 'updateMcpTabGroup'
  | 'inspectWorkspaceContinuity' | 'suspendWorkspaceContinuity' | 'armWorkspaceContinuity' | 'reconcileWorkspaceContinuity'
  | 'updateWorkspaceNavigationPolicy' | 'listWorkspaceNavigationAudit'
  | 'importWorkspaceTemplate' | 'createWorkspace' | 'listWorkspaceStorageOrigins' | 'transferWorkspaceStorage'
  | 'closeWorkspaceForPerson' | 'closeWorkspace' | 'saveAndCloseTabGroup' | 'restoreSavedTabGroup' | 'deleteSavedTabGroup'
  | 'showWorkspaceContextMenu'>

interface WorkspacesIpcHost {
  assertTrustedSender(event: IpcMainInvokeEvent): void
  /** Registers a handler that is refused while saved workspaces are still initializing or failed to start. */
  handleBrowserIpc(channel: string, listener: Parameters<IpcMain['handle']>[1]): void
  tabs(): WorkspacesIpcTabs | null
  /** Decisions agents wait on in a workspace; null until the MCP services start. */
  humanWaiting(): Pick<HumanWaitingService, 'list' | 'change'> | null
  /** The attention request the shell shows now; read on every check because a newer request replaces it. */
  userAttention(): Pick<UserAttentionRequest, 'id' | 'workspaceId'> | null
  /** The human-waiting decision the current attention request stands for, if any. */
  attentionDecisionId(): string | undefined
  mcpServer(): Pick<McpHttpServer, 'recordAgentDecisionAnswer'> | null
  /** The person answered the attention request: its signals stop, but it still shows until it ends. */
  quietUserAttention(): void
  /** Ends the attention request the shell shows. */
  endUserAttention(): void
  mainWindow(): BrowserWindow | null
  /** Electron's `dialog.showOpenDialog` on the given window. */
  showOpenDialog(window: BrowserWindow, options: OpenDialogOptions): Promise<OpenDialogReturnValue>
  /** Electron's `dialog.showSaveDialog` on the given window. */
  showSaveDialog(window: BrowserWindow, options: SaveDialogOptions): Promise<SaveDialogReturnValue>
  text(key: MessageKey, parameters?: MessageParameters): string
}

/** Dependencies stay lazy because handlers are registered before the window loads. */
export function registerWorkspacesIpc(host: WorkspacesIpcHost): void {
  host.handleBrowserIpc('browser:rename-tab-group', (event, groupId: unknown, name: unknown) => {
    host.assertTrustedSender(event)
    if (typeof groupId !== 'string' || typeof name !== 'string') throw new TypeError('Invalid workspace rename request')
    host.tabs()!.renameMcpTabGroup(groupId, name)
    return host.tabs()!.getState()
  })
  host.handleBrowserIpc('browser:update-tab-group', (event, groupId: unknown, updates: unknown) => {
    host.assertTrustedSender(event)
    if (typeof groupId !== 'string' || !updates || typeof updates !== 'object' || Array.isArray(updates)) {
      throw new TypeError('Invalid workspace update request')
    }
    const candidate = updates as Record<string, unknown>
    if (candidate.hiddenFromSidebar !== undefined && typeof candidate.hiddenFromSidebar !== 'boolean') throw new TypeError('Invalid workspace preference')
    if (candidate.deletionProtected !== undefined && typeof candidate.deletionProtected !== 'boolean') throw new TypeError('Invalid workspace preference')
    if (candidate.agentAccess !== undefined && typeof candidate.agentAccess !== 'boolean') throw new TypeError('Invalid workspace agent access')
    if (candidate.name !== undefined && typeof candidate.name !== 'string') throw new TypeError('Invalid workspace name')
    if (candidate.description !== undefined && typeof candidate.description !== 'string') throw new TypeError('Invalid workspace description')
    if (candidate.color !== undefined && !isBrowserTabGroupColor(candidate.color)) throw new TypeError('Invalid workspace color')
    host.tabs()!.updateMcpTabGroup(groupId, {
      ...(typeof candidate.hiddenFromSidebar === 'boolean' ? { hiddenFromSidebar: candidate.hiddenFromSidebar } : {}),
      ...(typeof candidate.deletionProtected === 'boolean' ? { deletionProtected: candidate.deletionProtected } : {}),
      ...(typeof candidate.agentAccess === 'boolean' ? { agentAccess: candidate.agentAccess } : {}),
      ...(typeof candidate.name === 'string' ? { name: candidate.name } : {}),
      ...(typeof candidate.description === 'string' ? { description: candidate.description } : {}),
      ...(isBrowserTabGroupColor(candidate.color) ? { color: candidate.color } : {})
    } satisfies BrowserTabGroupUpdate)
    return host.tabs()!.getState()
  })
  host.handleBrowserIpc('browser:review-workspace-continuity', (event, workspaceId: unknown) => {
    host.assertTrustedSender(event)
    if (typeof workspaceId !== 'string') throw new TypeError('Invalid workspace ID')
    return host.tabs()!.inspectWorkspaceContinuity(workspaceId)
  })
  host.handleBrowserIpc('browser:list-human-waiting', (event, workspaceId: unknown) => {
    const authorize = (): void => { host.assertTrustedSender(event) }
    authorize()
    if (typeof workspaceId !== 'string' || workspaceId.length > 128 || !host.humanWaiting()) throw new LocalizedError('appErrors.continuity.waitingWorkspaceUnavailable')
    return host.humanWaiting()!.list(workspaceId, authorize)
  })
  host.handleBrowserIpc('browser:change-human-waiting', async (event, workspaceId: unknown, id: unknown, revision: unknown, action: unknown, confirmation: unknown, note: unknown) => {
    const authorize = (): void => { host.assertTrustedSender(event) }
    authorize()
    if (typeof workspaceId !== 'string' || typeof id !== 'string' || typeof revision !== 'string'
      || workspaceId.length > 128 || id.length > 128 || revision.length > 128
      || (action !== 'acknowledge' && action !== 'cancel' && action !== 'reject' && action !== 'resolve') || !host.humanWaiting()) throw new LocalizedError('appErrors.continuity.decisionUnavailable')
    const trustedConfirmation = confirmation === undefined
      ? undefined
      : confirmation && typeof confirmation === 'object' && !Array.isArray(confirmation)
        && Object.keys(confirmation).length === 1
        && (confirmation as Record<string, unknown>).accountAndTargetVerified === true
        ? { accountAndTargetVerified: true as const }
        : null
    if (trustedConfirmation === null || (action !== 'resolve' && trustedConfirmation !== undefined)) {
      throw new LocalizedError('appErrors.continuity.confirmationUnavailable')
    }
    const answerNote = normalizeHumanWaitingNote(note)
    if (answerNote === null || (answerNote !== undefined && action === 'acknowledge')) {
      throw new LocalizedError('appErrors.continuity.noteUnavailable')
    }
    let checkpointId: string | null | undefined
    const validateFresh = async (): Promise<void> => {
      const report = await host.tabs()!.inspectWorkspaceContinuity(workspaceId)
      authorize()
      if (report.suspended || report.status === 'BLOCKED' || !report.checkpointId
        || (checkpointId !== undefined && checkpointId !== report.checkpointId)
        || (report.priorOutcome === 'OUTCOME_UNKNOWN' && !report.priorOutcomeAcknowledged)) {
        host.tabs()!.suspendWorkspaceContinuity(workspaceId)
        throw new LocalizedError('appErrors.continuity.reviewBeforeResolving')
      }
      checkpointId = report.checkpointId
    }
    const attentionId = host.userAttention()?.workspaceId === workspaceId && host.attentionDecisionId() === id ? host.userAttention()!.id : undefined
    const record = await host.humanWaiting()!.change(workspaceId, id, revision, action, authorize, validateFresh, trustedConfirmation, { note: answerNote })
    // The agent that asked sees how you answered in its steps, even when its request ended or another one replaced it.
    if (action !== 'acknowledge' && !humanWaitingDecisionOpen(record.state)) {
      host.mcpServer()?.recordAgentDecisionAnswer(workspaceId, id, agentAnswerForDecision(record.decision, action))
    }
    if (attentionId && host.userAttention()?.id === attentionId) {
      if (humanWaitingDecisionOpen(record.state)) host.quietUserAttention()
      else host.endUserAttention()
    }
    return record
  })
  host.handleBrowserIpc('browser:checkpoint-workspace-continuity', async (event, workspaceId: unknown, markerSelector: unknown) => {
    host.assertTrustedSender(event)
    if (typeof workspaceId !== 'string' || (markerSelector !== undefined && typeof markerSelector !== 'string')) throw new TypeError('Invalid continuity checkpoint')
    await host.tabs()!.armWorkspaceContinuity(workspaceId, markerSelector)
    return host.tabs()!.inspectWorkspaceContinuity(workspaceId)
  })
  host.handleBrowserIpc('browser:reconcile-workspace-continuity', async (event, workspaceId: unknown, reviewId: unknown, acknowledge: unknown) => {
    host.assertTrustedSender(event)
    if (typeof workspaceId !== 'string' || typeof reviewId !== 'string' || typeof acknowledge !== 'boolean') throw new TypeError('Invalid continuity review')
    await host.tabs()!.reconcileWorkspaceContinuity(workspaceId, reviewId, acknowledge)
    return host.tabs()!.inspectWorkspaceContinuity(workspaceId)
  })
  host.handleBrowserIpc('browser:update-workspace-navigation-policy', (event, groupId: unknown, policy: unknown) => {
    host.assertTrustedSender(event)
    if (typeof groupId !== 'string') throw new TypeError('Invalid workspace ID')
    const normalized = normalizeWorkspaceNavigationPolicy(policy)
    return host.tabs()!.updateWorkspaceNavigationPolicy(groupId, normalized)
  })
  host.handleBrowserIpc('browser:list-workspace-navigation-audit', (event, groupId: unknown) => {
    host.assertTrustedSender(event)
    if (typeof groupId !== 'string') throw new TypeError('Invalid workspace ID')
    return host.tabs()!.listWorkspaceNavigationAudit(groupId)
  })
  host.handleBrowserIpc('browser:open-workspace-template-file', async (event) => {
    host.assertTrustedSender(event)
    if (!host.mainWindow() || host.mainWindow()!.isDestroyed()) throw new Error(host.text('native.errors.actionFailed'))
    const selection = await host.showOpenDialog(host.mainWindow()!, {
      title: host.text('workspaceTemplates.openFile'),
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile', 'dontAddToRecent']
    })
    if (selection.canceled || !selection.filePaths[0]) return null
    try {
      return await readWorkspaceTemplateFile(selection.filePaths[0])
    } catch {
      throw new Error(host.text('workspaceTemplates.readFailed'))
    }
  })
  host.handleBrowserIpc('browser:save-workspace-template-file', async (event, value: unknown) => {
    host.assertTrustedSender(event)
    if (typeof value !== 'string') throw new TypeError(WORKSPACE_TEMPLATE_ERRORS.invalidTemplate)
    parseWorkspaceTemplate(value)
    if (!host.mainWindow() || host.mainWindow()!.isDestroyed()) throw new Error(host.text('native.errors.actionFailed'))
    const selection = await host.showSaveDialog(host.mainWindow()!, {
      title: host.text('workspaceTemplates.saveFile'),
      defaultPath: 'hronaut-workspace-template.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['showOverwriteConfirmation', 'dontAddToRecent']
    })
    if (selection.canceled || !selection.filePath) return false
    try {
      await writeWorkspaceTemplateFile(selection.filePath, value)
      return true
    } catch {
      throw new Error(host.text('workspaceTemplates.writeFailed'))
    }
  })
  host.handleBrowserIpc('browser:import-workspace-template', async (event, value: unknown) => {
    host.assertTrustedSender(event)
    if (typeof value !== 'string') throw new TypeError(WORKSPACE_TEMPLATE_ERRORS.invalidTemplate)
    const result = await host.tabs()!.importWorkspaceTemplate(value)
    return { ...result, state: host.tabs()!.getState() }
  })
  host.handleBrowserIpc('browser:create-workspace', async (event, value: unknown) => {
    host.assertTrustedSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid workspace creation request')
    const candidate = value as Record<string, unknown>
    if (typeof candidate.name !== 'string') throw new TypeError('Invalid workspace name')
    if (candidate.description !== undefined && typeof candidate.description !== 'string') throw new TypeError('Invalid workspace description')
    if (candidate.color !== undefined && !isBrowserTabGroupColor(candidate.color)) throw new TypeError('Invalid workspace color')
    if (candidate.storage !== 'scratch' && candidate.storage !== 'fork-workspace') throw new TypeError('Invalid workspace storage mode')
    if (candidate.origins !== undefined && (!Array.isArray(candidate.origins) || candidate.origins.some((origin) => typeof origin !== 'string'))) {
      throw new TypeError('Invalid workspace storage origins')
    }
    if (candidate.hiddenFromSidebar !== undefined && typeof candidate.hiddenFromSidebar !== 'boolean') throw new TypeError('Invalid workspace preference')
    if (candidate.deletionProtected !== undefined && typeof candidate.deletionProtected !== 'boolean') throw new TypeError('Invalid workspace preference')
    if (candidate.agentAccess !== undefined && typeof candidate.agentAccess !== 'boolean') throw new TypeError('Invalid workspace agent access')
    if (candidate.storage === 'fork-workspace' && typeof candidate.sourceWorkspaceId !== 'string') throw new TypeError('Source workspace is required')
    const navigationPolicy = candidate.navigationPolicy === undefined
      ? undefined
      : normalizeWorkspaceNavigationPolicy(candidate.navigationPolicy)
    return host.tabs()!.createWorkspace({
      name: candidate.name,
      ...(typeof candidate.description === 'string' ? { description: candidate.description } : {}),
      ...(isBrowserTabGroupColor(candidate.color) ? { color: candidate.color } : {}),
      storage: candidate.storage,
      ...(typeof candidate.sourceWorkspaceId === 'string' ? { sourceWorkspaceId: candidate.sourceWorkspaceId } : {}),
      ...(typeof candidate.hiddenFromSidebar === 'boolean' ? { hiddenFromSidebar: candidate.hiddenFromSidebar } : {}),
      ...(typeof candidate.deletionProtected === 'boolean' ? { deletionProtected: candidate.deletionProtected } : {}),
      ...(typeof candidate.agentAccess === 'boolean' ? { agentAccess: candidate.agentAccess } : {}),
      ...(Array.isArray(candidate.origins) ? { origins: candidate.origins as string[] } : {}),
      ...(navigationPolicy ? { navigationPolicy } : {})
    } satisfies BrowserWorkspaceCreateOptions)
  })
  host.handleBrowserIpc('browser:list-workspace-storage-origins', (event, workspaceId: unknown) => {
    host.assertTrustedSender(event)
    if (typeof workspaceId !== 'string') throw new TypeError('Invalid workspace ID')
    return host.tabs()!.listWorkspaceStorageOrigins(workspaceId)
  })
  host.handleBrowserIpc('browser:transfer-workspace-storage', (event, value: unknown) => {
    host.assertTrustedSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid workspace storage transfer')
    const candidate = value as Record<string, unknown>
    if (typeof candidate.sourceWorkspaceId !== 'string' || typeof candidate.targetWorkspaceId !== 'string') throw new TypeError('Source and destination workspaces are required')
    if (candidate.mode !== 'copy' && candidate.mode !== 'move') throw new TypeError('Invalid workspace transfer mode')
    if (candidate.origins !== undefined && (!Array.isArray(candidate.origins) || candidate.origins.some((origin) => typeof origin !== 'string'))) throw new TypeError('Invalid workspace storage origins')
    return host.tabs()!.transferWorkspaceStorage({
      sourceWorkspaceId: candidate.sourceWorkspaceId,
      targetWorkspaceId: candidate.targetWorkspaceId,
      mode: candidate.mode,
      ...(Array.isArray(candidate.origins) ? { origins: candidate.origins as string[] } : {})
    } satisfies BrowserWorkspaceStorageTransferOptions)
  })
  host.handleBrowserIpc('browser:close-workspace', async (event, workspaceId: unknown, options: unknown) => {
    host.assertTrustedSender(event)
    if (typeof workspaceId !== 'string') throw new TypeError('Invalid workspace ID')
    if (options !== undefined && (!options || typeof options !== 'object' || Array.isArray(options))) throw new TypeError('Invalid workspace close options')
    const undoable = (options as { undoable?: unknown } | undefined)?.undoable === true
    return undoable ? host.tabs()!.closeWorkspaceForPerson(workspaceId) : host.tabs()!.closeWorkspace(workspaceId)
  })
  host.handleBrowserIpc('browser:save-and-close-tab-group', async (event, groupId: unknown) => {
    host.assertTrustedSender(event)
    if (typeof groupId !== 'string') throw new TypeError('Invalid workspace ID')
    await host.tabs()!.saveAndCloseTabGroup(groupId)
    return host.tabs()!.getState()
  })
  host.handleBrowserIpc('browser:restore-saved-tab-group', async (event, savedGroupId: unknown) => {
    host.assertTrustedSender(event)
    if (typeof savedGroupId !== 'string') throw new TypeError('Invalid archived workspace ID')
    await host.tabs()!.restoreSavedTabGroup(savedGroupId)
    return host.tabs()!.getState()
  })
  host.handleBrowserIpc('browser:delete-saved-tab-group', async (event, savedGroupId: unknown) => {
    host.assertTrustedSender(event)
    if (typeof savedGroupId !== 'string') throw new TypeError('Invalid archived workspace ID')
    await host.tabs()!.deleteSavedTabGroup(savedGroupId)
    return host.tabs()!.getState()
  })
  host.handleBrowserIpc('browser:show-workspace-context-menu', (event, workspaceId: unknown) => {
    host.assertTrustedSender(event)
    if (typeof workspaceId !== 'string') throw new TypeError('Invalid workspace ID')
    host.tabs()!.showWorkspaceContextMenu(workspaceId)
  })
}

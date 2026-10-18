import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { textResult, toolDescription } from '../../tool-results.js'
import { workspaceIdSchema, workspaceResumeKeySchema } from '../../tool-schemas.js'
import { WorkspaceWriteLeaseError } from '../../workspace-write-leases.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserSavedWorkspaces(context: McpToolContext): void {
  const {
    activeWorkspaceIds,
    authorizeResume,
    authorizedSavedWorkspaces,
    client,
    forkOnlySource,
    leaseLostAfterDispatch,
    manager,
    registerTool,
    requireAgentWorkspace,
    requireSavedWorkspace,
    savedWorkspaceIds,
    tool,
    withResumeKey,
    workspaceLeases
  } = context
  registerTool(
    'browser_saved_workspaces',
    {
      description: toolDescription('browser_saved_workspaces'),
      inputSchema: {
        action: z.enum(['list', 'save', 'resume', 'open', 'delete']).default('list'),
        workspaceId: workspaceIdSchema.optional().describe('Your active UUIDv7 workspaceId. Required only for save.'),
        savedWorkspaceId: workspaceIdSchema.optional().describe('Archived UUIDv7 workspace ID returned by your own save call. Required for resume, open, or delete.'),
        resumeKey: workspaceResumeKeySchema.optional().describe('Private resume key returned by create or save. Required only for resume after reconnecting.')
      }
    },
    tool(async ({ action, workspaceId, savedWorkspaceId, resumeKey }: {
      action: 'list' | 'save' | 'resume' | 'open' | 'delete'
      workspaceId?: string
      savedWorkspaceId?: string
      resumeKey?: string
    }) => {
      if (action === 'list') {
        const authorized = authorizedSavedWorkspaces()
        const authorizedIds = new Set(authorized.map(workspace => workspace.id))
        return textResult([
          ...authorized,
          ...manager.listWorkspaceForkSources()
            .filter(source => source.archived && !authorizedIds.has(source.id))
            .map(forkOnlySource)
        ])
      }
      if (action === 'save') {
        if (!workspaceId) throw new TypeError('workspaceId is required to save a workspace')
        requireAgentWorkspace(workspaceId)
        const savingLease = workspaceLeases.require(workspaceId, client.id)
        const saved = await manager.saveAndCloseTabGroup(workspaceId)
        let leaseOutcome: CallToolResult | undefined
        try {
          if (savingLease.generation) workspaceLeases.require(workspaceId, client.id, savingLease.generation)
        } catch (error) {
          leaseOutcome = leaseLostAfterDispatch(error)
        }
        workspaceLeases.releaseAfterMutation(workspaceId, client.id)
        activeWorkspaceIds.delete(workspaceId)
        savedWorkspaceIds.add(saved.id)
        return leaseOutcome ?? textResult(withResumeKey(saved))
      }
      if (!savedWorkspaceId) throw new TypeError(`savedWorkspaceId is required to ${action} a saved workspace`)
      if (action === 'resume') {
        if (!resumeKey) throw new TypeError('resumeKey is required to resume an archived workspace')
        authorizeResume(savedWorkspaceId, resumeKey, true)
        const currentLease = workspaceLeases.status(savedWorkspaceId, client.id)
        const writeLease = currentLease.status === 'busy'
          ? currentLease
          : workspaceLeases.claim(savedWorkspaceId, client.id)
        const guarded = manager.suspendWorkspaceContinuity(savedWorkspaceId)
        const continuity = guarded ? await manager.inspectWorkspaceContinuity(savedWorkspaceId) : undefined
        requireSavedWorkspace(savedWorkspaceId)
        if (writeLease.generation) workspaceLeases.require(savedWorkspaceId, client.id, writeLease.generation)
        return textResult({ ...withResumeKey(manager.listSavedTabGroups().find((workspace) => workspace.id === savedWorkspaceId)!), writeLease, ...(continuity ? { continuity } : {}) })
      }
      requireSavedWorkspace(savedWorkspaceId)
      if (action === 'open') {
        const writeLease = workspaceLeases.require(savedWorkspaceId, client.id)
        try {
          const opened = await manager.restoreSavedTabGroup(savedWorkspaceId)
          workspaceLeases.require(savedWorkspaceId, client.id, writeLease.generation)
          savedWorkspaceIds.delete(savedWorkspaceId)
          activeWorkspaceIds.add(opened.id)
          const guarded = manager.suspendWorkspaceContinuity(opened.id)
          const continuity = guarded ? await manager.inspectWorkspaceContinuity(opened.id) : undefined
          requireAgentWorkspace(opened.id)
          return textResult({ ...withResumeKey(manager.requireMcpTabGroup(opened.id)), writeLease, ...(continuity ? { continuity } : {}) })
        } catch (error) {
          if (manager.listMcpTabGroups().some((workspace) => workspace.id === savedWorkspaceId)) {
            savedWorkspaceIds.delete(savedWorkspaceId)
            activeWorkspaceIds.add(savedWorkspaceId)
          }
          if (error instanceof WorkspaceWriteLeaseError) return leaseLostAfterDispatch(error)
          throw error
        }
      }
      const deletingLease = workspaceLeases.require(savedWorkspaceId, client.id)
      await manager.deleteSavedTabGroup(savedWorkspaceId)
      let leaseOutcome: CallToolResult | undefined
      try {
        if (deletingLease.generation) workspaceLeases.require(savedWorkspaceId, client.id, deletingLease.generation)
      } catch (error) {
        leaseOutcome = leaseLostAfterDispatch(error)
      }
      workspaceLeases.releaseAfterMutation(savedWorkspaceId, client.id)
      savedWorkspaceIds.delete(savedWorkspaceId)
      return leaseOutcome ?? textResult(authorizedSavedWorkspaces())
    }),
    {
      leaseTarget: input => ({ workspaceId: input.savedWorkspaceId, saved: input.action === 'open' || input.action === 'delete' }),
      pageOrigins: 'none'
    }
  )
}

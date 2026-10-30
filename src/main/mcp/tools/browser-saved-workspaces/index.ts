import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { savedWorkspaceWithoutUrlDetail, textResult, toolDescription, urlDetailOmitted } from '../../tool-results.js'
import { workspaceIdSchema, workspaceResumeKeySchema } from '../../tool-schemas.js'
import { WorkspaceWriteLeaseError } from '../../workspace-write-leases.js'
import type { McpToolContext } from '../tool-context.js'
import { listMcpTabGroups, requireMcpTabGroup } from '../../../browser/mcp-tab-groups/mcp-tab-groups.js'
import { saveAndCloseTabGroup, deleteSavedTabGroup, restoreSavedTabGroup } from '../../../browser/workspace-archive/workspace-archive.js'
import { inspectWorkspaceContinuity, suspendWorkspaceContinuity } from '../../../browser/workspace-continuity/workspace-continuity.js'

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
      // Saved tabs keep their full addresses; agents read them without detail when the person chose so.
      const omitUrlDetail = urlDetailOmitted(manager)
      const shown = <T extends { tabs: Array<{ url: string; title: string }> }>(workspace: T): T => omitUrlDetail ? savedWorkspaceWithoutUrlDetail(workspace) : workspace
      if (action === 'list') {
        const authorized = authorizedSavedWorkspaces().map(shown)
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
        const saved = await saveAndCloseTabGroup(manager, workspaceId)
        let leaseOutcome: CallToolResult | undefined
        try {
          if (savingLease.generation) workspaceLeases.require(workspaceId, client.id, savingLease.generation)
        } catch (error) {
          leaseOutcome = leaseLostAfterDispatch(error)
        }
        workspaceLeases.releaseAfterMutation(workspaceId, client.id)
        activeWorkspaceIds.delete(workspaceId)
        savedWorkspaceIds.add(saved.id)
        return leaseOutcome ?? textResult(withResumeKey(shown(saved)))
      }
      if (!savedWorkspaceId) throw new TypeError(`savedWorkspaceId is required to ${action} a saved workspace`)
      if (action === 'resume') {
        if (!resumeKey) throw new TypeError('resumeKey is required to resume an archived workspace')
        authorizeResume(savedWorkspaceId, resumeKey, true)
        const currentLease = workspaceLeases.status(savedWorkspaceId, client.id)
        const writeLease = currentLease.status === 'busy'
          ? currentLease
          : workspaceLeases.claim(savedWorkspaceId, client.id)
        const guarded = suspendWorkspaceContinuity(manager, savedWorkspaceId)
        const continuity = guarded ? await inspectWorkspaceContinuity(manager, savedWorkspaceId) : undefined
        requireSavedWorkspace(savedWorkspaceId)
        if (writeLease.generation) workspaceLeases.require(savedWorkspaceId, client.id, writeLease.generation)
        return textResult({ ...withResumeKey(shown(manager.listSavedTabGroups().find((workspace) => workspace.id === savedWorkspaceId)!)), writeLease, ...(continuity ? { continuity } : {}) })
      }
      requireSavedWorkspace(savedWorkspaceId)
      if (action === 'open') {
        const writeLease = workspaceLeases.require(savedWorkspaceId, client.id)
        try {
          // Like the agent's other calls, opening it leaves the person's window as it is.
          const opened = await restoreSavedTabGroup(manager, savedWorkspaceId, { show: false })
          workspaceLeases.require(savedWorkspaceId, client.id, writeLease.generation)
          savedWorkspaceIds.delete(savedWorkspaceId)
          activeWorkspaceIds.add(opened.id)
          const guarded = suspendWorkspaceContinuity(manager, opened.id)
          const continuity = guarded ? await inspectWorkspaceContinuity(manager, opened.id) : undefined
          requireAgentWorkspace(opened.id)
          return textResult({ ...withResumeKey(requireMcpTabGroup(manager, opened.id)), writeLease, ...(continuity ? { continuity } : {}) })
        } catch (error) {
          if (listMcpTabGroups(manager).some((workspace) => workspace.id === savedWorkspaceId)) {
            savedWorkspaceIds.delete(savedWorkspaceId)
            activeWorkspaceIds.add(savedWorkspaceId)
          }
          if (error instanceof WorkspaceWriteLeaseError) return leaseLostAfterDispatch(error)
          throw error
        }
      }
      const deletingLease = workspaceLeases.require(savedWorkspaceId, client.id)
      await deleteSavedTabGroup(manager, savedWorkspaceId)
      let leaseOutcome: CallToolResult | undefined
      try {
        if (deletingLease.generation) workspaceLeases.require(savedWorkspaceId, client.id, deletingLease.generation)
      } catch (error) {
        leaseOutcome = leaseLostAfterDispatch(error)
      }
      workspaceLeases.releaseAfterMutation(savedWorkspaceId, client.id)
      savedWorkspaceIds.delete(savedWorkspaceId)
      return leaseOutcome ?? textResult(authorizedSavedWorkspaces().map(shown))
    }),
    {
      leaseTarget: input => ({ workspaceId: input.savedWorkspaceId, saved: input.action === 'open' || input.action === 'delete' }),
      pageOrigins: 'none'
    }
  )
}

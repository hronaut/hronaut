import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { BROWSER_TAB_GROUP_COLORS, type BrowserTabGroupColor } from '../../../../shared/tab-groups.js'
import { RetainedBrowserWorkspaceError } from '../../../browser/workspace-errors.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { workspaceIdSchema, workspaceResumeKeySchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function normalizePublicObserverOrigin(value: string): string {
  const parsed = new URL(value)
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password) {
    throw new TypeError('observerOrigin must be a credential-free HTTP or HTTPS address')
  }
  return parsed.origin
}

export function registerBrowserWorkspaces(context: McpToolContext): void {
  const {
    activeWorkspaceIds,
    authorizeResume,
    authorizedActiveWorkspaces,
    capabilityProfile,
    client,
    forkOnlySource,
    getPaused,
    humanReviewSessionBinding,
    humanWaiting,
    leaseLostAfterDispatch,
    manager,
    registerTool,
    requireActiveCapabilityDispatch,
    requireAgentWorkspace,
    tool,
    withResumeKey,
    actionTracker,
    workspaceLeases
  } = context
  registerTool(
    'browser_workspaces',
    {
      description: toolDescription('browser_workspaces'),
      inputSchema: {
        action: z.enum(['list', 'list-fork-sources', 'create', 'resume', 'update', 'rename', 'close', 'list-origins', 'ownership-status', 'claim-ownership', 'release-ownership']).default('list').describe('Use list to discover forkOnly sources even when direct access is disabled; create a fresh task workspace before page tools. Create and resume claim exclusive write ownership. Use ownership-status to inspect it, claim-ownership after fresh inspection to recover it, and release-ownership for handoff. Use resume only after reconnecting, with the private resumeKey returned by create or archive operations.'),
        workspaceId: workspaceIdSchema.optional().describe('Stable UUIDv7 id returned by your own create call or by reopening your own archive. Pass this created workspace id to page tools. A rename changes only the human name, never this ID.'),
        resumeKey: workspaceResumeKeySchema.optional().describe('Private resume key returned when this workspace was created, archived, resumed, or reopened. Required only for resume after reconnecting. Never share it with another client or website.'),
        name: z.string().trim().min(1).max(80).optional().describe('Human-readable workspace name for create, update, or rename.'),
        description: z.string().max(1_000).optional().describe('Durable workspace purpose and context. Describe why it exists, current work, and what useful browser state it stores. Returned by list and resume.'),
        color: z.enum(BROWSER_TAB_GROUP_COLORS).optional().describe('Visible workspace color for create or update.'),
        sourceWorkspaceId: workspaceIdSchema.optional().describe('Required with storage=fork-workspace. Choose a forkOnly ID from list or any active or archived ID from list-fork-sources, including sources with direct agent access disabled. Forking never authorizes access to the source.'),
        storage: z.enum(['scratch', 'fork-workspace']).optional().describe('Required choice for an explicit create workflow: scratch (the default when omitted) starts from a clean isolated profile. fork-workspace copies reusable cookies and localStorage from sourceWorkspaceId into a fresh isolated workspace, inheriting its navigation restrictions. Forks do not copy source tabs. Source direct access may be disabled; the new agent workspace permits direct access. No fork authorizes browsing the original workspace.'),
        origins: z.array(z.string().url()).max(100).optional().describe('Optional HTTP(S) origins whose cookies and localStorage are copied during fork-workspace. Omit to copy all available cookies and known localStorage from the selected source.'),
        contextClass: z.enum(['standard', 'public-observer']).default('standard').describe('Use public-observer only for a clean, origin-scoped, read-only independent observation workspace.'),
        observerOrigin: z.string().url().optional().describe('Required with contextClass=public-observer. The clean observer workspace is restricted to this HTTP(S) origin; paths, query values, and fragments are discarded.')
      }
    },
    tool(async ({ action, workspaceId, resumeKey, name, description, color, storage, origins, sourceWorkspaceId, contextClass, observerOrigin }: {
      action: 'list' | 'list-fork-sources' | 'create' | 'resume' | 'update' | 'rename' | 'close' | 'list-origins' | 'ownership-status' | 'claim-ownership' | 'release-ownership'
      workspaceId?: string
      resumeKey?: string
      name?: string
      description?: string
      color?: BrowserTabGroupColor
      storage?: 'scratch' | 'fork-workspace'
      sourceWorkspaceId?: string
      origins?: string[]
      contextClass: 'standard' | 'public-observer'
      observerOrigin?: string
    }) => {
      if (action === 'list') return textResult([
        ...authorizedActiveWorkspaces().map(workspace => ({
          ...workspace,
          writeLease: workspaceLeases.status(workspace.id, client.id)
        })),
        ...manager.listWorkspaceForkSources().filter(source => !source.agentAccess).map(forkOnlySource)
      ])
      if (action === 'list-fork-sources') return textResult(manager.listWorkspaceForkSources())
      if (action === 'create') {
        if (!name) throw new TypeError('name is required to create a workspace')
        if (contextClass === 'public-observer' && !observerOrigin) throw new TypeError('observerOrigin is required for a public-observer workspace')
        if (contextClass === 'public-observer' && storage === 'fork-workspace') throw new TypeError('A public-observer workspace must use clean scratch storage')
        if (contextClass === 'standard' && observerOrigin !== undefined) throw new TypeError('observerOrigin is only supported with contextClass=public-observer')
        if (storage === 'fork-workspace' && !sourceWorkspaceId) throw new TypeError('sourceWorkspaceId is required for fork-workspace')
        if (sourceWorkspaceId !== undefined && storage !== 'fork-workspace') throw new TypeError('sourceWorkspaceId is only supported with fork-workspace')
        if (origins !== undefined && storage !== 'fork-workspace') {
          throw new TypeError('origins can be selected only when forking workspace storage')
        }
        const forkSourceId = storage === 'fork-workspace' ? sourceWorkspaceId : undefined
        const observerPolicy = contextClass === 'public-observer'
          ? { mode: 'restricted' as const, rules: [normalizePublicObserverOrigin(observerOrigin!)] }
          : undefined
        const scopedOrigins = origins ?? (forkSourceId ? capabilityProfile?.origins : undefined)
        const forkRevision = actionTracker.controlRevision
        if (forkSourceId && humanWaiting) await humanWaiting.requireDispatch(
          forkSourceId,
          () => { manager.requireWorkspaceContinuityDispatch(forkSourceId) },
          undefined,
          humanReviewSessionBinding
        )
        if (forkSourceId) manager.requireWorkspaceContinuityDispatch(forkSourceId)
        const finishFork = forkSourceId ? manager.beginWorkspaceContinuityAction(forkSourceId, false) : undefined
        const forkContextCurrent = async (): Promise<boolean> => {
          if (!forkSourceId) return true
          try {
            if (humanWaiting) await humanWaiting.requireDispatch(
              forkSourceId,
              () => { manager.requireWorkspaceContinuityDispatch(forkSourceId) },
              undefined,
              humanReviewSessionBinding
            )
            if (getPaused() || actionTracker.controlRevision !== forkRevision) return false
            manager.requireWorkspaceContinuityDispatch(forkSourceId)
            return true
          } catch { return false }
        }
        const interruptedFork = async (id: string): Promise<CallToolResult> => {
          if (forkSourceId) manager.suspendWorkspaceContinuity(forkSourceId, 'OUTCOME_UNKNOWN')
          const guardPersisted = await manager.requireWorkspaceContinuityReview(id)
          const outcome = {
            status: 'OUTCOME_UNKNOWN', effects: 'possible', workspaceId: id,
            resumeKey: manager.mcpWorkspaceResumeKey(id), retained: true, reviewRequired: true, guardPersisted,
            nextAction: 'Inspect and recover the retained workspace before continuing. Do not automatically repeat the fork.'
          }
          return { ...textResult(outcome), structuredContent: outcome, isError: true }
        }
        try {
          if (!await forkContextCurrent()) {
            throw new Error('MCP control changed before workspace creation. Obtain fresh state before retrying.')
          }
          requireActiveCapabilityDispatch('browser_workspaces', {
            action, name, description, color, storage, sourceWorkspaceId, contextClass, observerOrigin,
            ...(scopedOrigins ? { origins: scopedOrigins } : {})
          })
          const created = await manager.createMcpTabGroup(
            name, color, storage, scopedOrigins, true, observerPolicy, sourceWorkspaceId, description, contextClass
          )
          activeWorkspaceIds.add(created.id)
          const writeLease = workspaceLeases.claim(created.id, client.id)
          if (!await forkContextCurrent()) return await interruptedFork(created.id)
          return textResult({ ...withResumeKey(created), writeLease })
        } catch (error) {
          if (!(error instanceof RetainedBrowserWorkspaceError)) throw error
          const retained = manager.requireMcpTabGroup(error.workspaceId)
          activeWorkspaceIds.add(retained.id)
          const writeLease = workspaceLeases.claim(retained.id, client.id)
          if (!await forkContextCurrent()) return await interruptedFork(retained.id)
          return {
            ...textResult({
              error: error.message,
              workspaceId: retained.id,
              resumeKey: manager.mcpWorkspaceResumeKey(retained.id),
              retained: true,
              writeLease
            }),
            isError: true
          }
        } finally {
          finishFork?.()
        }
      }
      if (!workspaceId) throw new TypeError(`workspaceId is required to ${action} a workspace`)
      if (action === 'resume') {
        if (!resumeKey) throw new TypeError('resumeKey is required to resume a workspace')
        authorizeResume(workspaceId, resumeKey, false)
        const currentLease = workspaceLeases.status(workspaceId, client.id)
        const writeLease = currentLease.status === 'busy'
          ? currentLease
          : workspaceLeases.claim(workspaceId, client.id)
        const guarded = manager.suspendWorkspaceContinuity(workspaceId)
        const continuity = guarded ? await manager.inspectWorkspaceContinuity(workspaceId) : undefined
        // Marker reads cross an async boundary. A resume key cannot override
        // access revoked while the report was being captured.
        requireAgentWorkspace(workspaceId)
        if (writeLease.generation) workspaceLeases.require(workspaceId, client.id, writeLease.generation)
        return textResult({ ...withResumeKey(manager.requireMcpTabGroup(workspaceId)), writeLease, ...(continuity ? { continuity } : {}) })
      }
      requireAgentWorkspace(workspaceId)
      if (action === 'ownership-status') return textResult({ workspaceId, writeLease: workspaceLeases.status(workspaceId, client.id) })
      if (action === 'claim-ownership') return textResult({ workspaceId, writeLease: workspaceLeases.claim(workspaceId, client.id) })
      if (action === 'release-ownership') {
        const writeLease = workspaceLeases.release(workspaceId, client.id)
        manager.interruptPwaLifecycleWorkspace(workspaceId, 'ownership-released')
        return textResult({ workspaceId, writeLease })
      }
      if (action === 'rename') {
        if (!name) throw new TypeError('name is required to rename a workspace')
        return textResult(manager.renameMcpTabGroup(workspaceId, name, true))
      }
      if (action === 'update') {
        if (name === undefined && description === undefined && color === undefined) throw new TypeError('name, description, or color is required to update a workspace')
        return textResult(manager.updateMcpTabGroup(workspaceId, { name, description, color }, true))
      }
      if (action === 'list-origins') return textResult(manager.listWorkspaceStorageOrigins(workspaceId))
      const closingLease = workspaceLeases.require(workspaceId, client.id)
      await manager.closeMcpTabGroup(workspaceId)
      let leaseOutcome: CallToolResult | undefined
      try {
        if (closingLease.generation) workspaceLeases.require(workspaceId, client.id, closingLease.generation)
      } catch (error) {
        leaseOutcome = leaseLostAfterDispatch(error)
      }
      workspaceLeases.releaseAfterMutation(workspaceId, client.id)
      activeWorkspaceIds.delete(workspaceId)
      return leaseOutcome ?? textResult(authorizedActiveWorkspaces())
    }),
    {
      leaseExempt: input => ['create', 'resume', 'ownership-status', 'claim-ownership', 'release-ownership'].includes(String(input.action)),
      pageOrigins: 'none'
    }
  )
}

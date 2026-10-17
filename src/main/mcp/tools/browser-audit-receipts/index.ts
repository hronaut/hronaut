import { z } from 'zod'
import type { BrowserState } from '../../../../shared/types.js'
import { McpActionTracker } from '../../action-tracker.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { workspaceIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function auditEvidenceExpiredReason(
  state: { runtimeId?: string; controlRevision?: number; navigationGeneration: number; observationGeneration?: number },
  tab: { navigationGeneration: number; observationGeneration?: number } | undefined,
  tracker: Pick<McpActionTracker, 'runtimeId' | 'controlRevision'>
): 'no-tab' | 'runtime-changed' | 'control-changed' | 'navigation-changed' | 'observation-changed' | undefined {
  if (!tab) return 'no-tab'
  if (state.runtimeId !== tracker.runtimeId) return 'runtime-changed'
  if (state.controlRevision !== undefined && state.controlRevision !== tracker.controlRevision) return 'control-changed'
  if (tab.navigationGeneration !== state.navigationGeneration) return 'navigation-changed'
  if ((tab.observationGeneration ?? 0) !== (state.observationGeneration ?? 0)) return 'observation-changed'
  return undefined
}

export function registerBrowserAuditReceipts(context: McpToolContext): void {
  const {
    activeWorkspaceIds,
    auditReceipts,
    manager,
    registerTool,
    requireAgentWorkspace,
    savedWorkspaceIds,
    tool,
    workspaceAuthorizationError,
    actionTracker
  } = context
  registerTool(
    'browser_audit_receipts',
    {
      description: toolDescription('browser_audit_receipts'),
      inputSchema: {
        workspaceId: workspaceIdSchema.describe('Your active or archived workspace UUID. Resume ownership before reading after reconnecting.'),
        action: z.enum(['start', 'stop', 'list', 'read', 'evidence']).default('list'),
        runId: z.uuid().optional().describe('Retained run ID required for read or evidence lookup. The JSON response is a sanitized export.'),
        evidenceId: z.uuid().optional().describe('Opaque evidence reference returned by a retained audit read.')
      }
    },
    tool(async ({ workspaceId, action, runId, evidenceId }: {
      workspaceId: string
      action: 'start' | 'stop' | 'list' | 'read' | 'evidence'
      runId?: string
      evidenceId?: string
    }) => {
      const authorize = (): void => {
        if (action === 'start') {
          requireAgentWorkspace(workspaceId)
          return
        }
        if ((!activeWorkspaceIds.has(workspaceId) && !savedWorkspaceIds.has(workspaceId))
          || !manager.isWorkspaceAgentAccessible(workspaceId)) throw workspaceAuthorizationError()
      }
      authorize()
      if (!auditReceipts) throw new Error('Action audit receipt storage is unavailable')
      let result: unknown
      if (action === 'start') result = await auditReceipts.start(workspaceId)
      else if (action === 'stop') result = await auditReceipts.stop(workspaceId)
      else if (action === 'list') result = await auditReceipts.list(workspaceId)
      else if (action === 'read') {
        if (!runId) throw new TypeError('runId is required to read a retained audit run')
        result = await auditReceipts.read(workspaceId, runId)
      } else {
        if (!runId || !evidenceId) throw new TypeError('runId and evidenceId are required to resolve retained evidence')
        const evidence = await auditReceipts.evidence(workspaceId, runId, evidenceId)
        if (evidence.source === 'postcondition') {
          result = {
            ...evidence,
            openWith: { toolName: 'browser_audit_receipts', arguments: { workspaceId, action: 'read', runId }, receiptSequence: evidence.eventSequence }
          }
        } else if (!evidence.state?.tabId || evidence.source === 'site-access' || evidence.source === 'unspecified') {
          result = { ...evidence, status: 'expired', reason: 'no-tab', referenceId: null }
        } else {
          let tab: BrowserState['tabs'][number] | undefined
          try {
            tab = manager.getMcpGroupState(workspaceId).tabs.find(candidate => candidate.id === evidence.state!.tabId)
          } catch {
            tab = undefined
          }
          const expiredReason = auditEvidenceExpiredReason(evidence.state, tab, actionTracker)
          if (expiredReason) result = { ...evidence, status: 'expired', reason: expiredReason, referenceId: null }
          else {
            const open = evidence.source === 'diagnostic' ? { toolName: 'browser_debug_report', arguments: { workspaceId, tabId: tab!.id } }
              : evidence.source === 'network' ? { toolName: 'browser_network', arguments: { workspaceId, tabId: tab!.id } }
                : evidence.source === 'dom-changes' ? { toolName: 'browser_dom_changes', arguments: { workspaceId, tabId: tab!.id, action: 'get' } }
                  : evidence.source === 'storage-changes' ? { toolName: 'browser_storage_changes', arguments: { workspaceId, tabId: tab!.id, action: 'get' } }
                    : { toolName: 'browser_repro', arguments: { workspaceId, tabId: tab!.id, action: 'get' } }
            result = { ...evidence, openWith: open }
          }
        }
      }
      // A user can revoke agent access while bounded disk I/O is pending.
      authorize()
      return textResult(result)
    }),
    { leaseExempt: () => true }
  )
}

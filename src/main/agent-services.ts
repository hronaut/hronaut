import { app } from 'electron'
import { join } from 'node:path'
import { McpCapabilityProfileStore, type McpCapabilityProfile } from './mcp/capability-profile-store.js'
import { AuditReceiptService } from './mcp/audit-receipt-service.js'
import { mcpToolCatalogForSet } from './mcp/server.js'
import type { McpActionTracker } from './mcp/action-tracker.js'
import type { WorkspaceNavigationDecision } from './browser/workspace-navigation-policy.js'
import type { HumanWaitingService } from './mcp/human-waiting-service.js'
import type { TaskRunService } from './mcp/task-run-service.js'
import type { UserAttentionState } from './attention/tray-attention.js'
import { humanWaitingDecisionOpen } from '../shared/human-waiting.js'
import type { BrowserWorkspaceNavigationAuditSource } from '../shared/types.js'

/**
 * The services agents use beside the browser, created once by index.ts and started by startup. The MCP server, the
 * settings and workspace IPC and shutdown read the fields when they run, so they see each service from when it starts.
 */
export interface AgentServicesState {
  /** The capability profiles that limit what each agent may do, loaded before settings. */
  capabilityProfiles: McpCapabilityProfileStore | null
  /** The receipts of what agents did in each workspace, from when the main window opens. */
  auditReceipts: AuditReceiptService | null
  /** The decisions agents wait on the person for, from when the main window opens. */
  humanWaiting: HumanWaitingService | null
  /** The task runs agents record, from when the main window opens. */
  taskRuns: TaskRunService | null
}

interface AgentServicesHost {
  /** The services; index.ts creates the record, and the MCP server, the IPC handlers and shutdown read it too. */
  state: AgentServicesState
  /** The agent commands in flight, whose admitted dispatches a changed capability profile invalidates. */
  mcpActionTracker: Pick<McpActionTracker, 'invalidatePendingDispatches'>
  /** The attention request open for the person, which ends with the decision it stands for. */
  userAttention: Pick<UserAttentionState, 'request' | 'decisionId'>
  /** Ends the open attention request. */
  endUserAttention(options: { keepPending: boolean }): void
}

/**
 * Starting the services agents use beside the browser: the capability profiles at startup, then human-waiting
 * decisions, task runs and audit receipts when the main window opens. The decision and task run services load their
 * code only then. The tab runtime records each workspace's site access decisions in its audit receipts, and a closed
 * workspace's receipts are finalized.
 */
export function createAgentServices(host: AgentServicesHost): {
  openCapabilityProfiles(): Promise<McpCapabilityProfile[]>
  startAgentServices(): Promise<void>
  recordSiteAccess(workspaceId: string, decision: WorkspaceNavigationDecision, source: BrowserWorkspaceNavigationAuditSource): void
  finalizeWorkspaceReceipts(workspaceId: string): void
} {
  /** Opens the capability profiles file; the returned promise is its load, which startup waits for. */
  function openCapabilityProfiles(): Promise<McpCapabilityProfile[]> {
    host.state.capabilityProfiles = new McpCapabilityProfileStore(
      join(app.getPath('userData'), 'mcp-capability-profiles.json'),
      () => new Date(),
      () => host.mcpActionTracker.invalidatePendingDispatches()
    )
    return host.state.capabilityProfiles.load()
  }

  /** Starts the services that are not running yet; a decision's attention request ends with the decision. */
  async function startAgentServices(): Promise<void> {
    if (!host.state.humanWaiting) {
      const { HumanWaitingService } = await import('./mcp/human-waiting-service.js')
      const { HumanWaitingPersistence } = await import('./mcp/human-waiting-persistence.js')
      host.state.humanWaiting = new HumanWaitingService(new HumanWaitingPersistence(join(app.getPath('userData'), 'human-waiting.json')))
      host.state.humanWaiting.onSaved((records) => {
        // A decision's request ends with the decision, however it ends.
        const decisionId = host.userAttention.decisionId
        if (!decisionId || !host.userAttention.request) return
        const record = records.find((candidate) => candidate.id === decisionId)
        if (!record || !humanWaitingDecisionOpen(record.state)) host.endUserAttention({ keepPending: true })
      })
    }
    if (!host.state.taskRuns) {
      const { TaskRunService } = await import('./mcp/task-run-service.js')
      const { TaskRunPersistence } = await import('./mcp/task-run-persistence.js')
      host.state.taskRuns = new TaskRunService(new TaskRunPersistence(join(app.getPath('userData'), 'task-runs.json')))
    }
    host.state.auditReceipts ??= new AuditReceiptService(
      join(app.getPath('userData'), 'audit-receipts'),
      new Set(mcpToolCatalogForSet('complete').filter(tool => tool.name.startsWith('browser_')).map(tool => tool.name))
    )
  }

  /** Records a workspace's site access decision in its audit receipts, once they started. */
  function recordSiteAccess(workspaceId: string, decision: WorkspaceNavigationDecision, source: BrowserWorkspaceNavigationAuditSource): void {
    host.state.auditReceipts?.recordSiteAccess(workspaceId, decision, source)
  }

  /** Finalizes a closed workspace's audit receipts after the operation that closed it. */
  function finalizeWorkspaceReceipts(workspaceId: string): void {
    // Closing can itself be part of an active browser operation. Finalize
    // asynchronously so that operation can write its reserved outcome first.
    void Promise.resolve().then(() => host.state.auditReceipts?.stop(workspaceId)).catch(() => {
      console.error('[audit] Failed to finalize receipts for a closed workspace.')
    })
  }

  return { openCapabilityProfiles, startAgentServices, recordSiteAccess, finalizeWorkspaceReceipts }
}

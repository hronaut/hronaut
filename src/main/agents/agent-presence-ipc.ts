import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { McpHttpServer } from '../mcp/server.js'
import {
  parseAgentStepHistoryRequest,
  type AgentPresenceSnapshot,
  type AgentStepHistoryEntry
} from '../../shared/agent-presence.js'

interface AgentPresenceIpcHost {
  /** Admits only the main window's shell document, not a detached panel window. */
  assertMainShellSender(event: IpcMainInvokeEvent): void
  /** The agents in each open workspace; the revision increases only when the list changes. */
  agentPresenceSnapshot(): AgentPresenceSnapshot
  mcpServer(): Pick<McpHttpServer, 'getAgentStepHistory'> | null
}

/** Dependencies stay lazy because handlers are registered before the window loads. */
export function registerAgentPresenceIpc(ipcMain: Pick<IpcMain, 'handle'>, host: AgentPresenceIpcHost): void {
  ipcMain.handle('agent-presence:get', (event): AgentPresenceSnapshot => {
    host.assertMainShellSender(event)
    return host.agentPresenceSnapshot()
  })
  ipcMain.handle('agent-presence:steps', (event, value: unknown): AgentStepHistoryEntry[] | null => {
    host.assertMainShellSender(event)
    const request = parseAgentStepHistoryRequest(value)
    return host.mcpServer()?.getAgentStepHistory(request.clientKey, request.workspaceId, request.known) ?? null
  })
}

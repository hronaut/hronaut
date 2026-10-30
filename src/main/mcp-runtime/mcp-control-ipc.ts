import type { IpcMainInvokeEvent } from 'electron'
import type { TypedIpcMain } from '../typed-ipc.js'
import type { McpPortRecovery } from './mcp-port-suggestion.js'
import type { McpControlState, McpPortMoveResponse } from '../../shared/types.js'
import { MCP_IPC } from '../../shared/ipc/mcp.js'

interface McpControlIpcHost {
  assertTrustedSender(event: IpcMainInvokeEvent): void
  /** Registers a handler that is refused while saved workspaces are still initializing or failed to start. */
  handleBrowserIpc: TypedIpcMain['handle']
  /** The MCP server status, pause state and connected agents as the shell shows them. */
  currentMcpControlState(): McpControlState
  mcpPortRecovery(): Pick<McpPortRecovery, 'move'>
  /** Pauses or resumes agent access as the person's lasting choice; returns the state it publishes. */
  setMcpPaused(paused: boolean): McpControlState
}

/** Dependencies stay lazy because handlers are registered before the window loads. */
export function registerMcpControlIpc(ipcMain: Pick<TypedIpcMain, 'handle'>, host: McpControlIpcHost): void {
  ipcMain.handle(MCP_IPC.getState, (event) => {
    host.assertTrustedSender(event)
    return host.currentMcpControlState()
  })
  host.handleBrowserIpc(MCP_IPC.moveToSuggestedPort, async (event, port: unknown): Promise<McpPortMoveResponse> => {
    host.assertTrustedSender(event)
    const result = await host.mcpPortRecovery().move(port)
    return { result, state: host.currentMcpControlState() }
  })
  host.handleBrowserIpc(MCP_IPC.setPaused, (event, paused: unknown) => {
    host.assertTrustedSender(event)
    if (typeof paused !== 'boolean') throw new TypeError('MCP paused state must be a boolean')
    const state = host.setMcpPaused(paused)
    console.info(paused ? '[mcp] Paused by the user.' : '[mcp] Resumed by the user.')
    return state
  })
}

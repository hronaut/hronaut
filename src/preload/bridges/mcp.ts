import type { HronautMcpApi } from '../../shared/types.js'
import { MCP_IPC } from '../../shared/ipc/mcp.js'
import { invoke, subscribe } from './ipc.js'

/** window.hronautMcp: the MCP server's state and the person's controls over it. */
export const mcpApi: HronautMcpApi = {
  getState: () => invoke(MCP_IPC.getState),
  setPaused: (paused: boolean) => invoke(MCP_IPC.setPaused, paused),
  moveToSuggestedPort: (port: number) => invoke(MCP_IPC.moveToSuggestedPort, port),
  onChanged: (listener) => subscribe(MCP_IPC.changed, (state) => listener(state))
}

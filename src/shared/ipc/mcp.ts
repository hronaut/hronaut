import type { McpControlState, McpPortMoveResponse } from '../types.js'
import type { EventChannel, InvokeChannel } from './channel.js'

/** The MCP server's state and the person's controls over it, for the toolbar, Settings and Home. */
export const MCP_IPC = {
  /** Shell → main: the MCP server's state. */
  getState: 'mcp:get-state' as InvokeChannel<[], McpControlState>,
  /** Shell → main: pauses or resumes agents' access, answering with the state after. */
  setPaused: 'mcp:set-paused' as InvokeChannel<[paused: boolean], McpControlState>,
  /** Shell → main: moves the server to the port the state suggests; any other port is answered not-offered. */
  moveToSuggestedPort: 'mcp:move-to-suggested-port' as InvokeChannel<[port: number], McpPortMoveResponse>,
  /** Main → shells: the MCP server's state changed. */
  changed: 'mcp:changed' as EventChannel<[state: McpControlState]>
} as const

import type { McpHttpServer } from './mcp/server.js'
import type { McpTokenConfiguration } from './mcp-token-store.js'
import type { McpServerStatus } from '../shared/types.js'

/**
 * The MCP listener's runtime state, created once by index.ts. Startup and port changes replace the server and its
 * address together; every reader reads the fields when it runs, so it always sees the current listener.
 */
export interface McpRuntimeState {
  /** The address the listener binds: a loopback host, or every interface when settings allow remote access. */
  host: string
  /** The running MCP server; null before startup and after shutdown, and replaced when the port changes. */
  server: McpHttpServer | null
  /** The port the listener uses, from settings or HRONAUT_MCP_PORT. */
  port: number
  /** The endpoint agents connect to, which Home, setup and the tab runtime show. */
  url: string
  /** Whether the listener is starting, ready or failed to start. */
  status: Exclude<McpServerStatus, 'paused'>
  /** Why the listener failed to start, until it listens. */
  startupError: string | undefined
  /** The bearer token and the file it is saved in, once loaded at startup. */
  tokenConfiguration: McpTokenConfiguration | null
}

import type { Client } from '@modelcontextprotocol/sdk/client/index.js'

export interface McpWorkspaceConnection {
  workspaceId: string
  resumeKey: string
}

export function connectMcpWorkspace(
  client: Client,
  name: string,
  ensureTab?: boolean,
  resume?: McpWorkspaceConnection
): Promise<McpWorkspaceConnection>

export function useMcpWorkspace(
  client: Client,
  name: string,
  ensureTab?: boolean
): Promise<string>

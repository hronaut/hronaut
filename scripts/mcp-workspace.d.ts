import type { Client } from '@modelcontextprotocol/sdk/client/index.js'

export function useMcpWorkspace(
  client: Client,
  name: string,
  ensureTab?: boolean,
  reuseExisting?: boolean
): Promise<string>

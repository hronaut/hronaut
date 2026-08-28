export const MCP_TOOL_SETS = ['essentials', 'qa', 'complete'] as const

export type McpToolSet = typeof MCP_TOOL_SETS[number]

export const DEFAULT_MCP_TOOL_SET: McpToolSet = 'essentials'
export const LEGACY_MCP_TOOL_SET: McpToolSet = 'complete'

export function isMcpToolSet(value: unknown): value is McpToolSet {
  return typeof value === 'string' && MCP_TOOL_SETS.includes(value as McpToolSet)
}

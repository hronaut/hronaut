export const DEFAULT_MCP_PORT = 47_812
export const MIN_MCP_PORT = 1_024
export const MAX_MCP_PORT = 65_535

export function isValidMcpPort(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= MIN_MCP_PORT && Number(value) <= MAX_MCP_PORT
}

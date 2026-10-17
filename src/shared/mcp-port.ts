import type { McpControlState } from './types.js'

export const DEFAULT_MCP_PORT = 47_812
export const MIN_MCP_PORT = 1_024
export const MAX_MCP_PORT = 65_535

export function isValidMcpPort(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= MIN_MCP_PORT && Number(value) <= MAX_MCP_PORT
}

/** A listener that could not use its port because it was busy or refused, in plain words; null for any other failure. */
export function mcpPortProblem(state: Pick<McpControlState, 'status' | 'errorCode' | 'failedPort'>): { key: 'portInUse' | 'portDenied'; port: number } | null {
  if (state.status !== 'error' || !state.failedPort) return null
  if (state.errorCode === 'port-in-use') return { key: 'portInUse', port: state.failedPort }
  if (state.errorCode === 'port-denied') return { key: 'portDenied', port: state.failedPort }
  return null
}

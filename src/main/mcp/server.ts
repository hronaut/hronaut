/** The MCP server's public entry: the HTTP server, the tool catalog and the contracts other modules and tests import. */
export { BROWSER_SERVER_INSTRUCTIONS, BROWSER_TOOL_CATALOG, mcpToolCatalogForSet } from './tool-catalog.js'
export type { BrowserToolDefinition } from './tool-catalog.js'
export type { McpToolActivity, McpToolMetric } from './activity-history.js'
export {
  WorkspaceWriteLeaseError,
  WorkspaceWriteLeaseRegistry,
  type WorkspaceWriteLeaseStatus
} from './workspace-write-leases.js'
export type { UserAttentionInput, UserAttentionRequest } from '../../shared/types.js'
export { assertMcpCapabilityClassificationContract, mcpCapabilityAction, mcpCapabilityOperationClass, READ_ONLY_MULTI_ACTIONS } from './capability-classification.js'
export { classifyMcpActivityResult, closedTabWaitResult } from './tool-results.js'
export { auditEvidenceExpiredReason } from './tools/browser-audit-receipts/index.js'
export { browserClickPageInput } from './tools/browser-click/index.js'
export { MCP_FAILED_AUTH_LIMIT, McpHttpServer, mcpRequestAuthorized } from './http-server.js'
export type { McpClientActivity, McpDashboardState, McpHttpServerOptions } from './http-server.js'
export { assertMcpToolRegistrationContract } from './browser-mcp-server.js'
export { mcpCapabilityProfileInputFromPreset } from './capability-presets.js'
export { WalletAgentSessionRegistry } from './wallet-agent-sessions.js'
export type { WalletAgentOperations, WalletAgentToolTarget } from './wallet-agent-sessions.js'
export type { BookmarkOperations, HistoryOperations, SiteDataOperations, SiteDataType } from './browser-data-operations.js'

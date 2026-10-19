// How each MCP tool call is classified for capability profiles: read-only, or which kind of change it makes.
import type { McpCapabilityOperationClass } from './capability-profile-store.js'
import { type AdvertisedBrowserToolDefinition, BROWSER_TOOL_CATALOG } from './tool-catalog.js'
import { toolDefinition } from './tool-results.js'

export const READ_ONLY_MULTI_ACTIONS: Readonly<Record<string, ReadonlySet<string>>> = {
  browser_human_waiting: new Set(['list']),
  browser_fixed_date: new Set(['status']),
  browser_continuity: new Set(['status']),
  browser_audit_receipts: new Set(['list', 'read', 'evidence']),
  browser_task_runs: new Set(['get', 'list', 'metrics', 'list-saved', 'preview']),
  browser_workspaces: new Set(['list', 'list-fork-sources', 'resume', 'list-origins', 'ownership-status']),
  browser_saved_workspaces: new Set(['list', 'resume']),
  browser_bookmarks: new Set(['list']),
  browser_visit_history: new Set(['list']),
  browser_site_data: new Set(['inspect']),
  browser_storage: new Set(['list', 'get']),
  browser_storage_changes: new Set(['get']),
  browser_repro: new Set(['get']),
  browser_video: new Set(['get', 'inspect']),
  browser_dom_changes: new Set(['get']),
  browser_dom_mutation_source: new Set(['get']),
  browser_live_region: new Set(['get']),
  browser_css_state_preview: new Set(['get']),
  browser_virtual_passkey: new Set(['status']),
  browser_pwa_lifecycle: new Set(['get']),
  browser_issues: new Set(['list']),
  browser_console: new Set(['list']),
  browser_diagnostic_logs: new Set(['get']),
  browser_network: new Set(['list']),
  browser_network_routes: new Set(['list', 'held']),
  browser_workers: new Set(['list']),
  // Records are what expressions read from the page, so reading them takes the same permission as adding them.
  browser_logpoint: new Set(['scripts']),
  browser_downloads: new Set(['list']),
  browser_webmcp: new Set(['status', 'list'])
}

export const MCP_NON_READ_OPERATION_CLASSES: Readonly<Record<string, McpCapabilityOperationClass>> = {
  browser_human_waiting: 'browser-state',
  browser_continuity: 'browser-state',
  browser_audit_receipts: 'browser-state',
  browser_task_runs: 'browser-state',
  browser_workspaces: 'browser-state',
  browser_saved_workspaces: 'browser-state',
  browser_show: 'browser-state',
  browser_request_user_attention: 'browser-state',
  browser_new_tab: 'navigate',
  browser_select_tab: 'browser-state',
  browser_close_tab: 'browser-state',
  browser_bookmarks: 'browser-state',
  browser_visit_history: 'browser-state',
  browser_site_data: 'site-data',
  browser_storage: 'site-data',
  browser_storage_changes: 'browser-state',
  browser_navigate: 'navigate',
  browser_history: 'navigate',
  browser_click: 'interact',
  browser_dialog: 'interact',
  browser_type: 'interact',
  browser_select: 'interact',
  browser_fill_form: 'interact',
  browser_hover: 'interact',
  browser_drag: 'interact',
  browser_scroll: 'interact',
  browser_wheel: 'interact',
  browser_touch: 'interact',
  browser_press: 'interact',
  browser_insert_text: 'interact',
  browser_hold_key: 'interact',
  browser_file_upload: 'external-request',
  browser_file_drop: 'external-request',
  browser_fill_from_file: 'external-request',
  browser_emulate: 'browser-state',
  browser_page_lifecycle: 'browser-state',
  browser_resize: 'browser-state',
  browser_zoom: 'browser-state',
  browser_audio: 'browser-state',
  browser_screenshot: 'browser-state',
  browser_pdf_save: 'external-request',
  browser_screenshot_save: 'external-request',
  browser_performance: 'browser-state',
  browser_code_coverage: 'browser-state',
  browser_react: 'browser-state',
  browser_fixed_date: 'browser-state',
  browser_cpu_profile: 'browser-state',
  browser_memory: 'browser-state',
  browser_repro: 'browser-state',
  browser_video: 'browser-state',
  browser_dom_changes: 'browser-state',
  browser_dom_mutation_source: 'browser-state',
  browser_live_region: 'browser-state',
  browser_css_state_preview: 'browser-state',
  browser_virtual_passkey: 'browser-state',
  browser_pwa_lifecycle: 'browser-state',
  browser_visual_compare: 'browser-state',
  browser_issues: 'browser-state',
  browser_console: 'browser-state',
  browser_diagnostic_logs: 'browser-state',
  browser_network: 'network',
  browser_network_replay: 'network',
  browser_network_har: 'network',
  browser_network_routes: 'network',
  browser_downloads: 'external-request',
  browser_download_copy: 'external-request',
  browser_evaluate: 'interact',
  browser_evaluate_file: 'interact',
  browser_workers: 'interact',
  browser_logpoint: 'interact',
  browser_webmcp: 'interact',
  wallet_list: 'wallet',
  wallet_balance: 'wallet',
  wallet_prepare_transaction: 'wallet',
  wallet_request: 'wallet',
  wallet_request_status: 'wallet',
  wallet_page_requests: 'wallet',
  wallet_cancel_request: 'wallet'
}

export function mcpCapabilityOperationClass(
  toolName: string,
  input: Record<string, unknown>
): McpCapabilityOperationClass {
  if (toolName === 'browser_video' && (input.action === 'export' || input.action === 'import-audio')) return 'external-request'
  const action = mcpCapabilityAction(toolName, input)
  if (toolDefinition(toolName).annotations.readOnlyHint
    || (action !== undefined && READ_ONLY_MULTI_ACTIONS[toolName]?.has(action))) return 'read'
  const operationClass = MCP_NON_READ_OPERATION_CLASSES[toolName]
  if (!operationClass) throw new Error(`MCP capability operation class is unrecognized for ${toolName}`)
  return operationClass
}

export function mcpCapabilityAction(toolName: string, input: Record<string, unknown>): string | undefined {
  if (typeof input.action === 'string') return input.action
  if (toolName === 'browser_console' || toolName === 'browser_network') return input.clear === true ? 'clear' : 'list'
  if (toolName === 'browser_downloads') return 'list'
  if (toolName === 'browser_pwa_lifecycle') return 'get'
  return undefined
}

export function assertMcpCapabilityClassificationContract(
  catalog: readonly AdvertisedBrowserToolDefinition[] = BROWSER_TOOL_CATALOG
): void {
  const catalogNames = new Set(catalog.map(tool => tool.name))
  const missing = catalog
    .filter(tool => !tool.annotations.readOnlyHint && !MCP_NON_READ_OPERATION_CLASSES[tool.name])
    .map(tool => tool.name)
    .sort()
  const unknown = Object.keys(MCP_NON_READ_OPERATION_CLASSES)
    .filter(toolName => !catalogNames.has(toolName))
    .sort()
  if (missing.length || unknown.length) {
    throw new Error([
      ...missing.map(toolName => `missing operation class: ${toolName}`),
      ...unknown.map(toolName => `unknown operation-class entry: ${toolName}`)
    ].join('; '))
  }
}

assertMcpCapabilityClassificationContract()

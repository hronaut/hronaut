export const enUSHomeReadiness = {
  heading: 'MCP readiness',
  description: 'Verify each boundary separately before relying on browser tools.',
  checks: {
    app: 'Application',
    endpoint: 'Local endpoint',
    initialization: 'Client initialization',
    advertisedTools: 'Advertised tools',
    configuration: 'Client configuration',
    clientVisibility: 'Tools visible in active client',
    probe: 'Read-only probe'
  },
  inventory: 'Paste the tool list shown by the active client',
  inventoryPlaceholder: 'Paste client output containing browser_* or wallet_* tool names',
  verifyInventory: 'Compare tool list',
  copyReport: 'Copy diagnostic',
  reportLabel: 'Copy-safe MCP readiness diagnostic',
  privacy: 'Comparison stays on this page. The copied report contains only typed states, counts, bounded tool names, and timestamps.',
  nextAction: {
    start_honaut: 'Start or repair the local Hronaut listener.',
    connect_client: 'Reconnect the active MCP client and wait for initialization.',
    verify_client_configuration: 'Confirm this endpoint and authentication in the active client configuration.',
    list_tools_in_active_client: 'List tools in the active client and compare them here.',
    run_read_only_probe: 'In a task-owned workspace, invoke browser_status or browser_snapshot once.',
    retry_read_only_probe: 'Inspect the active client error, then retry one read-only probe.',
    none: 'No action needed for this check.'
  }
}

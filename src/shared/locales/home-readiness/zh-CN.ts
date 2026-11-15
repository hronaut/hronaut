export const zhCNHomeReadiness = {
  heading: 'MCP 就绪状态',
  description: '在依赖浏览器工具之前，请逐一验证每个环节。',
  checks: {
    app: '应用',
    endpoint: '本地端点',
    initialization: '客户端初始化',
    advertisedTools: '公布的工具',
    configuration: '客户端配置',
    clientVisibility: '活动客户端中可见的工具',
    probe: '只读探测'
  },
  inventory: '粘贴活动客户端显示的工具列表',
  inventoryPlaceholder: '粘贴包含 browser_* 或 wallet_* 工具名称的客户端输出',
  verifyInventory: '比较工具列表',
  copyReport: '复制诊断信息',
  reportLabel: '可安全复制的 MCP 就绪诊断信息',
  privacy: '比较仅在此页面上进行。复制的报告仅包含类型化状态、计数、有限的工具名称和时间戳。',
  nextAction: {
    start_honaut: '启动或修复本地 Hronaut 监听器。',
    connect_client: '重新连接活动的 MCP 客户端，并等待初始化完成。',
    verify_client_configuration: '在活动客户端的配置中确认此端点和身份验证设置。',
    list_tools_in_active_client: '在活动客户端中列出工具，然后在此处进行比较。',
    run_read_only_probe: '在任务专属的工作区中，调用一次 browser_status 或 browser_snapshot。',
    retry_read_only_probe: '检查活动客户端的错误，然后重试一次只读探测。',
    none: '此检查无需执行任何操作。'
  }
}

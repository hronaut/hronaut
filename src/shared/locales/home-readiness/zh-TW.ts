export const zhTWHomeReadiness = {
  heading: 'MCP 就緒狀態',
  description: '在依賴瀏覽器工具之前，請逐一驗證每個環節。',
  checks: {
    app: '應用程式',
    endpoint: '本機端點',
    initialization: '用戶端初始化',
    advertisedTools: '已宣告的工具',
    configuration: '用戶端設定',
    clientVisibility: '使用中用戶端可見的工具',
    probe: '唯讀探測'
  },
  inventory: '貼上使用中用戶端顯示的工具清單',
  inventoryPlaceholder: '貼上包含 browser_* 或 wallet_* 工具名稱的用戶端輸出內容',
  verifyInventory: '比對工具清單',
  copyReport: '複製診斷資訊',
  reportLabel: '可安全複製的 MCP 就緒狀態診斷',
  privacy: '比對只會在這個頁面上進行。複製的報告只包含類型化的狀態、數量、長度受限的工具名稱和時間戳記。',
  nextAction: {
    start_honaut: '啟動或修復本機的 Hronaut 監聽程式。',
    connect_client: '重新連線使用中的 MCP 用戶端，並等待初始化完成。',
    verify_client_configuration: '在使用中用戶端的設定中確認這個端點與驗證方式。',
    list_tools_in_active_client: '在使用中的用戶端列出工具，然後在這裡比對。',
    run_read_only_probe: '在任務專屬的工作區中，呼叫一次 browser_status 或 browser_snapshot。',
    retry_read_only_probe: '檢查使用中用戶端的錯誤，然後再試一次唯讀探測。',
    none: '這項檢查不需要採取任何動作。'
  }
}

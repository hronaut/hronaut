export const viVNHomeReadiness = {
  heading: 'Mức sẵn sàng của MCP',
  description: 'Hãy xác minh riêng từng ranh giới trước khi dựa vào các công cụ trình duyệt.',
  checks: {
    app: 'Ứng dụng',
    endpoint: 'Điểm cuối cục bộ',
    initialization: 'Khởi tạo ứng dụng khách',
    advertisedTools: 'Công cụ được công bố',
    configuration: 'Cấu hình ứng dụng khách',
    clientVisibility: 'Công cụ hiển thị trong ứng dụng khách đang dùng',
    probe: 'Thăm dò chỉ đọc'
  },
  inventory: 'Dán danh sách công cụ mà ứng dụng khách đang dùng hiển thị',
  inventoryPlaceholder: 'Dán kết quả của ứng dụng khách có chứa tên công cụ browser_* hoặc wallet_*',
  verifyInventory: 'So sánh danh sách công cụ',
  copyReport: 'Sao chép thông tin chẩn đoán',
  reportLabel: 'Thông tin chẩn đoán mức sẵn sàng MCP an toàn để sao chép',
  privacy: 'Việc so sánh chỉ diễn ra trên trang này. Báo cáo được sao chép chỉ chứa các trạng thái đã phân loại, số lượng, tên công cụ có giới hạn và dấu thời gian.',
  nextAction: {
    start_honaut: 'Khởi động hoặc sửa trình nghe Hronaut cục bộ.',
    connect_client: 'Kết nối lại ứng dụng khách MCP đang dùng và đợi quá trình khởi tạo.',
    verify_client_configuration: 'Xác nhận điểm cuối và thông tin xác thực này trong cấu hình của ứng dụng khách đang dùng.',
    list_tools_in_active_client: 'Liệt kê công cụ trong ứng dụng khách đang dùng và so sánh tại đây.',
    run_read_only_probe: 'Trong một không gian làm việc thuộc về nhiệm vụ, hãy gọi browser_status hoặc browser_snapshot một lần.',
    retry_read_only_probe: 'Kiểm tra lỗi của ứng dụng khách đang dùng, rồi thử lại một lượt thăm dò chỉ đọc.',
    none: 'Không cần thao tác nào cho bước kiểm tra này.'
  }
}

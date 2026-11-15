export const viVNNetworkLabels = {
  resourceTypes: {
    document: 'Tài liệu',
    stylesheet: 'Biểu định kiểu',
    image: 'Hình ảnh',
    media: 'Nội dung đa phương tiện',
    font: 'Phông chữ',
    script: 'Tập lệnh',
    texttrack: 'Kênh văn bản',
    xhr: 'XHR',
    fetch: 'Fetch',
    prefetch: 'Tìm nạp trước',
    eventsource: 'EventSource',
    websocket: 'WebSocket',
    manifest: 'Tệp kê khai',
    signedexchange: 'Trao đổi đã ký',
    ping: 'Ping',
    cspviolationreport: 'Báo cáo vi phạm CSP',
    preflight: 'Kiểm tra trước',
    fedcm: 'FedCM',
    other: 'Khác'
  },
  responseSources: {
    network: 'Mạng',
    serviceWorker: 'Service worker',
    prefetchCache: 'Bộ nhớ đệm tìm nạp trước',
    diskCache: 'Bộ nhớ đệm trên ổ đĩa',
    otherCache: 'Bộ nhớ đệm của trình duyệt'
  },
  workerSources: {
    cacheStorage: 'Cache Storage',
    httpCache: 'Bộ nhớ đệm HTTP',
    fallbackCode: 'Mã dự phòng của worker',
    network: 'Mạng qua worker'
  },
  initiatorTypes: {
    parser: 'Trình phân tích cú pháp',
    script: 'Tập lệnh',
    preload: 'Tải trước',
    signedexchange: 'Trao đổi đã ký',
    preflight: 'Kiểm tra trước',
    fedcm: 'FedCM',
    redirect: 'Chuyển hướng',
    other: 'Khác'
  },
  messageDirections: {
    sent: 'đã gửi',
    received: 'đã nhận',
    error: 'lỗi'
  },
  messageKinds: {
    text: 'văn bản',
    binary: 'nhị phân',
    continuation: 'tiếp nối',
    close: 'đóng',
    ping: 'ping',
    pong: 'pong',
    error: 'lỗi',
    unknown: 'không xác định'
  },
  bodyNotes: {
    binary: 'Đã bỏ qua nội dung nhị phân.',
    multipart: 'Đã bỏ qua nội dung nhiều phần.',
    unsafeJson: 'Đã bỏ qua nội dung JSON vì không thể ẩn thông tin nhạy cảm một cách an toàn.',
    nonText: 'Đã bỏ qua nội dung không phải văn bản.'
  },
  bodyReasons: {
    eventStream: 'Các sự kiện do máy chủ gửi có trong mục Luồng sự kiện có giới hạn.',
    webSocket: 'Các tin nhắn WebSocket có trong mục tin nhắn có giới hạn.',
    expired: 'Chromium không còn cung cấp nội dung phản hồi.',
    incomplete: 'Nội dung phản hồi chưa hoàn tất.',
    devToolsCapture: 'Không thể ghi lại chi tiết trong khi Công cụ cho nhà phát triển đang kiểm soát thẻ này.',
    omittedFromExport: 'Nội dung phản hồi đã bị bỏ qua trong bản xuất đã làm sạch này.',
    closeDevTools: 'Hãy đóng Công cụ cho nhà phát triển của thẻ này, rồi yêu cầu lại các chi tiết này.',
    evicted: 'Chromium không còn giữ nội dung phản hồi này trong bộ đệm chẩn đoán có giới hạn.'
  },
  searchFields: {
    error: 'Lỗi yêu cầu',
    message: 'Tin nhắn {kind} {direction}',
    event: 'Sự kiện {name}'
  }
}

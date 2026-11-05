export const viVNTrustedDialogs = {
  close: 'Đóng',
  httpAuth: {
    eyebrow: 'Đăng nhập',
    headline: 'Đăng nhập vào {origin}',
    notPrivate: 'Kết nối của bạn với trang web này không riêng tư. Bất kỳ ai trên mạng cũng có thể đọc tên người dùng và mật khẩu của bạn.',
    workspace: 'Bạn vẫn đăng nhập trang web này trong không gian làm việc “{workspace}” cho đến khi Hronaut thoát.',
    sent: 'Hronaut chỉ gửi tên người dùng và mật khẩu của bạn đến trang web này và không bao giờ hiển thị chúng cho tác nhân.',
    username: 'Tên người dùng',
    password: 'Mật khẩu',
    signIn: 'Đăng nhập'
  },
  certificate: {
    eyebrow: 'Không riêng tư',
    headline: 'Tiếp tục truy cập {host}?',
    authority: 'Chứng chỉ bảo mật của trang không do một tổ chức mà máy tính này tin cậy cấp.',
    name: 'Chứng chỉ bảo mật của trang thuộc về một trang web khác.',
    date: 'Chứng chỉ bảo mật của trang đã hết hạn hoặc chưa có hiệu lực.',
    other: 'Không thể xác minh chứng chỉ bảo mật của trang.',
    risk: 'Ai đó trên mạng có thể đang giả mạo trang web này để đọc những gì bạn gửi đến, chẳng hạn như mật khẩu.',
    workspace: 'Hronaut tin cậy chứng chỉ này cho trang web này trong không gian làm việc “{workspace}” cho đến khi Hronaut thoát, và các tác nhân trong không gian làm việc cũng có thể mở trang.',
    session: 'Hronaut tin cậy chứng chỉ này cho trang web này cho đến khi Hronaut thoát.',
    back: 'Quay lại an toàn',
    proceed: 'Tiếp tục (không an toàn)'
  },
  savePassword: {
    eyebrow: 'Mật khẩu đã lưu',
    save: 'Lưu mật khẩu của bạn cho {origin}?',
    update: 'Cập nhật mật khẩu đã lưu của bạn cho {origin}?',
    username: 'Tên người dùng',
    noUsername: 'Trang không gửi kèm tên người dùng.',
    stored: 'Hronaut mã hóa mật khẩu bằng bộ nhớ bảo mật của hệ điều hành. Mật khẩu đã lưu không bao giờ bị lộ qua MCP.'
  },
  walletRecovery: {
    eyebrow: 'Ví mới',
    headline: 'Ghi lại cụm từ khôi phục cho {wallet}',
    phrase: 'Cụm từ khôi phục',
    keep: 'Hãy ghi lại các từ này theo đúng thứ tự và cất giữ ngoại tuyến. Bất kỳ ai có các từ này đều kiểm soát được ví.',
    added: 'Hronaut sẽ thêm ví sau khi bạn xác nhận đã lưu các từ này.'
  },
  claudeSetup: {
    file: 'Tệp',
    added: 'Mục mới trong "mcpServers"',
    replaces: 'Mục bị thay thế'
  },
  sitePermission: {
    embeddedIn: 'Được nhúng trong {site}',
    wants: {
      camera: '{origin} muốn sử dụng máy ảnh của bạn',
      microphone: '{origin} muốn sử dụng micrô của bạn',
      cameraAndMicrophone: '{origin} muốn sử dụng máy ảnh và micrô của bạn',
      geolocation: '{origin} muốn biết vị trí của bạn',
      notifications: '{origin} muốn hiển thị thông báo',
      clipboardRead: '{origin} muốn xem văn bản và hình ảnh mà bạn sao chép',
      clipboardWrite: '{origin} muốn sao chép văn bản và hình ảnh vào bảng nhớ tạm của bạn',
      midiSysex: '{origin} muốn điều khiển và lập trình lại các thiết bị MIDI của bạn',
      midi: '{origin} muốn sử dụng các thiết bị MIDI của bạn',
      localFonts: '{origin} muốn sử dụng phông chữ trên máy tính của bạn',
      localNetwork: '{origin} muốn tìm và kết nối với các thiết bị trong mạng cục bộ của bạn',
      loopbackNetwork: '{origin} muốn kết nối với các ứng dụng và dịch vụ trên thiết bị này',
      fileSystem: '{origin} muốn sử dụng một tệp hoặc thư mục trên máy tính của bạn',
      openExternal: '{origin} muốn mở một ứng dụng trên máy tính của bạn',
      fullscreen: '{origin} muốn sử dụng toàn màn hình',
      idleDetection: '{origin} muốn biết khi nào bạn đang sử dụng thiết bị này',
      keyboardLock: '{origin} muốn chặn và sử dụng các phím tắt của bạn',
      pointerLock: '{origin} muốn khóa và ẩn con trỏ chuột của bạn',
      persistentStorage: '{origin} muốn lưu trữ dữ liệu vĩnh viễn trên thiết bị này',
      screenWakeLock: '{origin} muốn giữ cho màn hình của bạn luôn bật',
      storageAccess: '{origin} muốn sử dụng cookie và dữ liệu trang web của mình trên trang này',
      topLevelStorageAccess: '{origin} muốn sử dụng cookie và dữ liệu trang web của các trang web có liên quan',
      windowManagement: '{origin} muốn quản lý cửa sổ trên tất cả màn hình của bạn',
      displayCapture: '{origin} muốn xem màn hình của bạn',
      other: '{origin} muốn sử dụng “{permission}”'
    }
  }
}

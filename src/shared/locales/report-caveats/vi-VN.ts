export const viVNReportCaveats = {
  performance: {
    lcpPhases: 'Các giai đoạn LCP là quan sát về thời gian của trình duyệt, không phải bằng chứng nhân quả. Bằng chứng bị thiếu hoặc bị hạn chế được nêu rõ; chưa hỗ trợ phân bổ giai đoạn cho việc khôi phục trang và điều hướng mềm.',
    localSample: 'Đây là một mẫu cục bộ của lượt truy cập hiện tại, không phải dữ liệu thực tế hay kết quả CrUX ở phân vị thứ 75.',
    inpUnavailable: 'INP chưa có cho đến khi trang nhận được một lượt tương tác đủ điều kiện; một số chỉ số không có đối với lượt truy cập trong nền hoặc tồn tại ngắn.',
    longAnimationFrames: 'Phân bổ khung hình ảnh động dài xác định điểm bắt đầu của tập lệnh, không nhất thiết là hàm nội bộ chậm nhất.',
    crossOrigin: 'Khung, worker, service worker trên nguồn gốc khác và mã trong thế giới tách biệt có thể đóng góp công việc mà không được phân bổ cho tập lệnh.',
    userTimings: 'Tên User Timing do trang tạo và đã được làm sạch; các đối tượng chi tiết tùy ý, dấu vết ngăn xếp và mã nguồn đều bị bỏ qua.',
    layoutShifts: 'Bằng chứng về thay đổi bố cục không bao gồm các mục có thao tác nhập riêng lẻ gần đây. Tổng điểm của chúng chỉ dùng để chẩn đoán và có thể khác với cách tính điểm CLS theo cửa sổ phiên.',
    baselineUrl: 'URL đường cơ sở khác với lần đo này; chỉ so sánh nếu bạn cố ý thay đổi điều hướng.',
    environment: 'Môi trường trình duyệt khác với đường cơ sở; các thay đổi về khung nhìn, điều tiết, bộ nhớ đệm, tiêu đề hoặc ngôn ngữ có thể ảnh hưởng đến mức chênh lệch.',
    deltas: 'Mức chênh lệch trước và sau so sánh hai mẫu cục bộ và có thể bao gồm biến động bình thường giữa các lần chạy; hãy lặp lại các phép đo quan trọng trong điều kiện giống nhau.'
  },
  accessibilityComparison: {
    urlChanged: 'URL của trang đã thay đổi sau đường cơ sở hỗ trợ tiếp cận.',
    scopeChanged: 'Tiêu chuẩn hỗ trợ tiếp cận, bộ chọn hoặc giới hạn thu thập đã thay đổi; hãy đặt đường cơ sở mới cho phạm vi này.',
    engineChanged: 'Công cụ kiểm tra hỗ trợ tiếp cận đã thay đổi; hãy đặt đường cơ sở mới trước khi so sánh kết quả.',
    baselineTruncated: 'Đường cơ sở đã bị cắt bớt nên không thể xác định một cách an toàn các kết quả mới.',
    currentTruncated: 'Lượt kiểm tra hiện tại đã bị cắt bớt nên không thể xác định một cách an toàn các kết quả đã được khắc phục.'
  },
  indexedDb: {
    origin: 'Chỉ bao gồm nguồn gốc cấp cao nhất này; không bao gồm cơ sở dữ liệu trong khung của bên thứ ba.',
    snapshot: 'Cơ sở dữ liệu và bản ghi là ảnh chụp nhanh tại một thời điểm. Hãy làm mới sau khi trang web thay đổi IndexedDB.',
    names: 'Tên cơ sở dữ liệu, kho đối tượng, chỉ mục và khóa do trang web đặt và bản thân chúng có thể chứa dữ liệu riêng tư.',
    longNames: 'Các cơ sở dữ liệu và kho đối tượng có tên dài hơn 512 ký tự sẽ bị bỏ qua.',
    valuesIncluded: 'Bản xem trước bản ghi có giới hạn và có thể chứa dữ liệu riêng tư của ứng dụng.',
    valuesOmitted: 'Giá trị bản ghi bị bỏ qua.',
    readOnly: 'Trình kiểm tra này chỉ đọc IndexedDB và không bao giờ thay đổi hay xóa dữ liệu trong đó.'
  },
  storageUsage: {
    estimates: 'Mức sử dụng và hạn mức là ước tính của trình duyệt tại một thời điểm và có thể thay đổi khi Chromium loại bỏ hoặc ghi dữ liệu.',
    quota: 'Hạn mức là dung lượng mà Chromium hiện báo cáo cho nguồn gốc này, không phải dung lượng trống trên thiết bị.',
    origin: 'Chỉ bao gồm nguồn gốc HTTP(S) cấp cao nhất này; bộ nhớ của bên thứ ba và bộ nhớ được phân vùng có thể được tính riêng.',
    aggregates: 'Chỉ hiển thị tổng số byte và các danh mục bộ nhớ của trình duyệt. Khóa, giá trị, tên tệp và nội dung phản hồi không bao giờ được đưa vào.',
    readOnly: 'Trình kiểm tra này chỉ đọc mức sử dụng bộ nhớ và không bao giờ thay đổi hay xóa dữ liệu.',
    fallback: 'Không có thông tin chi tiết về hạn mức của Chromium, nên báo cáo này dùng ước tính tổng thể của trình duyệt: {reason}'
  },
  storageChanges: {
    baseline: 'Đường cơ sở chỉ được giữ trong bộ nhớ và sẽ bị loại bỏ khi bạn xóa, khi thẻ đổi nguồn gốc hoặc đóng, hoặc khi Hronaut thoát.',
    scope: 'Bộ nhớ cục bộ và cookie được chia sẻ theo nguồn gốc trong không gian làm việc này và tách biệt với các không gian làm việc khác; bộ nhớ phiên chỉ thuộc về thẻ này.',
    valuesIncluded: 'Giá trị được hiển thị trong giới hạn kích thước. Giá trị cookie HttpOnly luôn được bảo vệ.',
    valuesOmitted: 'Giá trị bị bỏ qua.',
    snapshot: 'Ảnh chụp nhanh bao gồm 200 mục đầu tiên đã sắp xếp của mỗi loại bộ nhớ. Bộ nhớ cũng có thể thay đổi trong nền giữa thời điểm lấy đường cơ sở và thời điểm so sánh.'
  },
  pwa: {
    origin: 'Chỉ bao gồm nguồn gốc cấp cao nhất này; không bao gồm worker và bộ nhớ đệm trong khung của bên thứ ba.',
    snapshot: 'Các bản đăng ký và mục được lưu vào bộ nhớ đệm là ảnh chụp nhanh tại một thời điểm. Hãy làm mới sau khi trang web thay đổi trạng thái ngoại tuyến.',
    manifest: 'Tệp kê khai được đọc thành một vài trường có giới hạn; nguồn thô của tệp không bao giờ được hiển thị.',
    installabilityIds: 'Mã nhận dạng lỗi về khả năng cài đặt đến từ Chromium và có thể thay đổi giữa các phiên bản Chromium.',
    readOnly: 'Trình kiểm tra này chỉ đọc dữ liệu ngoại tuyến và không bao giờ hiển thị nội dung phản hồi đã lưu vào bộ nhớ đệm.',
    headersIncluded: 'Tiêu đề yêu cầu và phản hồi được hiển thị trong một giới hạn; các tiêu đề được nhận dạng là chứa thông tin bí mật sẽ bị ẩn.',
    headersOmitted: 'Giá trị tiêu đề bị bỏ qua.',
    opaqueSizes: 'Kích thước của phản hồi không rõ nội dung có thể bao gồm phần đệm hạn mức của trình duyệt và không được đo ở đây.',
    clearing: 'Trình kiểm tra này không bao giờ hủy đăng ký worker hoặc xóa bộ nhớ đệm.',
    installabilityUnavailable: 'Không có thông tin chẩn đoán về khả năng cài đặt: {reason}'
  }
}

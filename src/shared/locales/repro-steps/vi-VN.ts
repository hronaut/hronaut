export const viVNReproSteps = {
  kinds: {
    navigate: 'điều hướng',
    click: 'nhấp',
    input: 'nhập',
    key: 'phím',
    scroll: 'cuộn',
    expect: 'kỳ vọng'
  },
  steps: {
    open: 'Mở {url}',
    navigate: 'Điều hướng đến {url}',
    navigateWithin: 'Điều hướng trong trang đến {url}',
    click: 'Nhấp vào {target}',
    input: 'Nhập vào {target} (không ghi lại giá trị)',
    key: 'Nhấn {key} trên {target}',
    scroll: 'Cuộn đến x={x}, y={y}',
    expect: 'Kết quả mong đợi: {condition}',
    captureFailed: 'Không thể ghi lại mục tiêu của thao tác; hãy tạo lại thao tác này theo cách thủ công.',
    captureInterrupted: 'Việc ghi lại thao tác bị gián đoạn do điều hướng; hãy tạo lại thao tác này theo cách thủ công.'
  },
  targets: {
    input: 'trường nhập {type}',
    labelled: '{kind} “{label}”'
  },
  conditions: {
    visible: 'hiển thị',
    hidden: 'ẩn',
    text: 'văn bản',
    checked: 'đã đánh dấu',
    unchecked: 'chưa đánh dấu',
    count: 'số lượng',
    urlPath: 'đường dẫn URL'
  }
}

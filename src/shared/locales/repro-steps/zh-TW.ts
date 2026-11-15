export const zhTWReproSteps = {
  kinds: {
    navigate: '導覽',
    click: '點擊',
    input: '輸入',
    key: '按鍵',
    scroll: '捲動',
    expect: '檢查點'
  },
  steps: {
    open: '開啟 {url}',
    navigate: '前往 {url}',
    navigateWithin: '在頁面內前往 {url}',
    click: '點擊 {target}',
    input: '在 {target} 中輸入（未記錄輸入值）',
    key: '在 {target} 上按下 {key}',
    scroll: '捲動至 x={x}, y={y}',
    expect: '預期結果：{condition}',
    captureFailed: '無法擷取動作目標，請手動重新建立這個動作。',
    captureInterrupted: '動作擷取因導覽而中斷，請手動重新建立這個動作。'
  },
  targets: {
    input: '{type} 輸入欄位',
    labelled: '{kind}「{label}」'
  },
  conditions: {
    visible: '可見',
    hidden: '隱藏',
    text: '文字',
    checked: '已勾選',
    unchecked: '未勾選',
    count: '數量',
    urlPath: 'URL 路徑'
  }
}

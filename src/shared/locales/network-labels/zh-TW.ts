export const zhTWNetworkLabels = {
  resourceTypes: {
    document: '文件',
    stylesheet: '樣式表',
    image: '圖片',
    media: '媒體',
    font: '字型',
    script: '指令碼',
    texttrack: '文字軌',
    xhr: 'XHR',
    fetch: 'Fetch',
    prefetch: '預先擷取',
    eventsource: 'EventSource',
    websocket: 'WebSocket',
    manifest: '資訊清單',
    signedexchange: '已簽署交換',
    ping: 'Ping',
    cspviolationreport: 'CSP 違規報告',
    preflight: '預檢',
    fedcm: 'FedCM',
    other: '其他'
  },
  responseSources: {
    network: '網路',
    serviceWorker: 'Service Worker',
    prefetchCache: '預先擷取快取',
    diskCache: '磁碟快取',
    otherCache: '瀏覽器快取'
  },
  workerSources: {
    cacheStorage: '快取儲存空間',
    httpCache: 'HTTP 快取',
    fallbackCode: 'Worker 備援程式碼',
    network: '透過 Worker 的網路'
  },
  initiatorTypes: {
    parser: '剖析器',
    script: '指令碼',
    preload: '預先載入',
    signedexchange: '已簽署交換',
    preflight: '預檢',
    fedcm: 'FedCM',
    redirect: '重新導向',
    other: '其他'
  },
  messageDirections: {
    sent: '已傳送',
    received: '已接收',
    error: '錯誤'
  },
  messageKinds: {
    text: '文字',
    binary: '二進位',
    continuation: '接續',
    close: '關閉',
    ping: 'ping',
    pong: 'pong',
    error: '錯誤',
    unknown: '不明'
  },
  bodyNotes: {
    binary: '已省略二進位內文。',
    multipart: '已省略多部分內文。',
    unsafeJson: 'JSON 內文無法安全遮蓋，因此已省略。',
    nonText: '已省略非文字內文。'
  },
  bodyReasons: {
    eventStream: '伺服器推送事件可在有長度上限的「事件串流」區段中查看。',
    webSocket: 'WebSocket 訊息可在有長度上限的訊息區段中查看。',
    expired: 'Chromium 已無法再提供回應內文。',
    incomplete: '回應內文尚未完成。',
    devToolsCapture: '開發人員工具控制這個分頁時，無法進行詳細擷取。',
    omittedFromExport: '這份經過清理的匯出內容已省略回應內文。',
    closeDevTools: '請關閉這個分頁的開發人員工具，然後再次要求這些詳細資料。',
    evicted: 'Chromium 有上限的診斷緩衝區中已不再保有這個回應內文。'
  },
  searchFields: {
    error: '要求錯誤',
    message: '{direction}的{kind}訊息',
    event: '{name} 事件'
  }
}

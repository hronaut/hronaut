export const zhCNNetworkLabels = {
  resourceTypes: {
    document: '文档',
    stylesheet: '样式表',
    image: '图片',
    media: '媒体',
    font: '字体',
    script: '脚本',
    texttrack: '文本轨道',
    xhr: 'XHR',
    fetch: 'Fetch',
    prefetch: '预提取',
    eventsource: 'EventSource',
    websocket: 'WebSocket',
    manifest: '清单',
    signedexchange: 'Signed Exchange',
    ping: 'Ping',
    cspviolationreport: 'CSP 违规报告',
    preflight: '预检',
    fedcm: 'FedCM',
    other: '其他'
  },
  responseSources: {
    network: '网络',
    serviceWorker: 'Service Worker',
    prefetchCache: '预提取缓存',
    diskCache: '磁盘缓存',
    otherCache: '浏览器缓存'
  },
  workerSources: {
    cacheStorage: '缓存存储',
    httpCache: 'HTTP 缓存',
    fallbackCode: 'Worker 后备代码',
    network: '经由 Worker 的网络'
  },
  initiatorTypes: {
    parser: '解析器',
    script: '脚本',
    preload: '预加载',
    signedexchange: 'Signed Exchange',
    preflight: '预检',
    fedcm: 'FedCM',
    redirect: '重定向',
    other: '其他'
  },
  messageDirections: {
    sent: '已发送',
    received: '已接收',
    error: '错误'
  },
  messageKinds: {
    text: '文本',
    binary: '二进制',
    continuation: '延续',
    close: '关闭',
    ping: 'ping',
    pong: 'pong',
    error: '错误',
    unknown: '未知'
  },
  bodyNotes: {
    binary: '已省略二进制正文。',
    multipart: '已省略 multipart 正文。',
    unsafeJson: '由于无法安全地隐去敏感内容，已省略 JSON 正文。',
    nonText: '已省略非文本正文。'
  },
  bodyReasons: {
    eventStream: '服务器发送的事件可在有限的“事件流”部分中查看。',
    webSocket: 'WebSocket 消息可在有限的“消息”部分中查看。',
    expired: 'Chromium 已不再提供响应正文。',
    incomplete: '响应正文尚未完成。',
    devToolsCapture: '开发者工具占用此标签页期间，无法进行详细捕获。',
    omittedFromExport: '此已脱敏的导出中省略了响应正文。',
    closeDevTools: '请关闭此标签页的开发者工具，然后重新请求这些详细信息。',
    evicted: 'Chromium 的有限诊断缓冲区中已不再保留此响应正文。'
  },
  searchFields: {
    error: '请求错误',
    message: '{direction}的{kind}消息',
    event: '{name} 事件'
  }
}

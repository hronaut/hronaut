export const jaJPNetworkLabels = {
  resourceTypes: {
    document: 'ドキュメント',
    stylesheet: 'スタイルシート',
    image: '画像',
    media: 'メディア',
    font: 'フォント',
    script: 'スクリプト',
    texttrack: 'テキスト トラック',
    xhr: 'XHR',
    fetch: 'Fetch',
    prefetch: 'プリフェッチ',
    eventsource: 'EventSource',
    websocket: 'WebSocket',
    manifest: 'マニフェスト',
    signedexchange: '署名付き交換',
    ping: 'Ping',
    cspviolationreport: 'CSP 違反レポート',
    preflight: 'プリフライト',
    fedcm: 'FedCM',
    other: 'その他'
  },
  responseSources: {
    network: 'ネットワーク',
    serviceWorker: 'Service Worker',
    prefetchCache: 'プリフェッチ キャッシュ',
    diskCache: 'ディスク キャッシュ',
    otherCache: 'ブラウザ キャッシュ'
  },
  workerSources: {
    cacheStorage: 'Cache Storage',
    httpCache: 'HTTP キャッシュ',
    fallbackCode: 'ワーカーのフォールバック コード',
    network: 'ワーカー経由のネットワーク'
  },
  initiatorTypes: {
    parser: 'パーサー',
    script: 'スクリプト',
    preload: 'プリロード',
    signedexchange: '署名付き交換',
    preflight: 'プリフライト',
    fedcm: 'FedCM',
    redirect: 'リダイレクト',
    other: 'その他'
  },
  messageDirections: {
    sent: '送信',
    received: '受信',
    error: 'エラー'
  },
  messageKinds: {
    text: 'テキスト',
    binary: 'バイナリ',
    continuation: '継続',
    close: 'クローズ',
    ping: 'ping',
    pong: 'pong',
    error: 'エラー',
    unknown: '不明'
  },
  bodyNotes: {
    binary: 'バイナリの本文は除外されました。',
    multipart: 'マルチパートの本文は除外されました。',
    unsafeJson: '安全に秘匿化できなかったため、JSON の本文は除外されました。',
    nonText: 'テキスト以外の本文は除外されました。'
  },
  bodyReasons: {
    eventStream: 'サーバー送信イベントは、範囲を限定した [イベント ストリーム] セクションで確認できます。',
    webSocket: 'WebSocket のメッセージは、範囲を限定した [メッセージ] セクションで確認できます。',
    expired: 'レスポンスの本文は Chromium から取得できなくなりました。',
    incomplete: 'レスポンスの本文はまだ完了していません。',
    devToolsCapture: 'デベロッパー ツールがこのタブを使用している間は、詳細な取得を利用できませんでした。',
    omittedFromExport: 'このサニタイズ済みのエクスポートでは、レスポンスの本文は除外されました。',
    closeDevTools: 'このタブのデベロッパー ツールを閉じてから、もう一度これらの詳細をリクエストしてください。',
    evicted: 'Chromium の範囲を限定した診断バッファには、このレスポンスの本文はもうありません。'
  },
  searchFields: {
    error: 'リクエストのエラー',
    message: '{kind}メッセージ（{direction}）',
    event: '{name} イベント'
  }
}

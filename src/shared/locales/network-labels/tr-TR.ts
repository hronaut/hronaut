export const trTRNetworkLabels = {
  resourceTypes: {
    document: 'Belge',
    stylesheet: 'Stil sayfası',
    image: 'Resim',
    media: 'Medya',
    font: 'Yazı tipi',
    script: 'Komut dosyası',
    texttrack: 'Metin parçası',
    xhr: 'XHR',
    fetch: 'Fetch',
    prefetch: 'Önceden getirme',
    eventsource: 'EventSource',
    websocket: 'WebSocket',
    manifest: 'Manifest',
    signedexchange: 'İmzalı değişim',
    ping: 'Ping',
    cspviolationreport: 'CSP ihlali raporu',
    preflight: 'Ön kontrol',
    fedcm: 'FedCM',
    other: 'Diğer'
  },
  responseSources: {
    network: 'Ağ',
    serviceWorker: 'Service worker',
    prefetchCache: 'Önceden getirme önbelleği',
    diskCache: 'Disk önbelleği',
    otherCache: 'Tarayıcı önbelleği'
  },
  workerSources: {
    cacheStorage: 'Cache Storage',
    httpCache: 'HTTP önbelleği',
    fallbackCode: 'Worker yedek kodu',
    network: 'Worker üzerinden ağ'
  },
  initiatorTypes: {
    parser: 'Ayrıştırıcı',
    script: 'Komut dosyası',
    preload: 'Önceden yükleme',
    signedexchange: 'İmzalı değişim',
    preflight: 'Ön kontrol',
    fedcm: 'FedCM',
    redirect: 'Yönlendirme',
    other: 'Diğer'
  },
  messageDirections: {
    sent: 'gönderilen',
    received: 'alınan',
    error: 'hata'
  },
  messageKinds: {
    text: 'metin',
    binary: 'ikili',
    continuation: 'devam',
    close: 'kapatma',
    ping: 'ping',
    pong: 'pong',
    error: 'hata',
    unknown: 'bilinmeyen'
  },
  bodyNotes: {
    binary: 'İkili gövde çıkarıldı.',
    multipart: 'Çok parçalı gövde çıkarıldı.',
    unsafeJson: 'JSON gövdesi güvenli şekilde gizlenemediği için çıkarıldı.',
    nonText: 'Metin olmayan gövde çıkarıldı.'
  },
  bodyReasons: {
    eventStream: 'Sunucu tarafından gönderilen olaylar, sınırlı Olay akışı bölümünde bulunur.',
    webSocket: 'WebSocket mesajları, sınırlı mesajlar bölümünde bulunur.',
    expired: 'Yanıt gövdesi artık Chromium’da bulunmuyor.',
    incomplete: 'Yanıt gövdesi henüz tamamlanmadı.',
    devToolsCapture: 'Bu sekme Geliştirici araçlarının denetimindeyken ayrıntılı yakalama kullanılamadı.',
    omittedFromExport: 'Yanıt gövdesi bu temizlenmiş dışa aktarımdan çıkarıldı.',
    closeDevTools: 'Bu sekmenin Geliştirici araçlarını kapatın, ardından bu ayrıntıları tekrar isteyin.',
    evicted: 'Chromium’un sınırlı tanılama arabelleğinde bu yanıt gövdesi artık yok.'
  },
  searchFields: {
    error: 'İstek hatası',
    message: '{direction} {kind} mesajı',
    event: '{name} olayı'
  }
}

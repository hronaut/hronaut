export const idIDNetworkLabels = {
  resourceTypes: {
    document: 'Dokumen',
    stylesheet: 'Stylesheet',
    image: 'Gambar',
    media: 'Media',
    font: 'Font',
    script: 'Skrip',
    texttrack: 'Trek teks',
    xhr: 'XHR',
    fetch: 'Fetch',
    prefetch: 'Prefetch',
    eventsource: 'EventSource',
    websocket: 'WebSocket',
    manifest: 'Manifes',
    signedexchange: 'Pertukaran bertanda tangan',
    ping: 'Ping',
    cspviolationreport: 'Laporan pelanggaran CSP',
    preflight: 'Preflight',
    fedcm: 'FedCM',
    other: 'Lainnya'
  },
  responseSources: {
    network: 'Jaringan',
    serviceWorker: 'Service worker',
    prefetchCache: 'Cache prefetch',
    diskCache: 'Cache disk',
    otherCache: 'Cache browser'
  },
  workerSources: {
    cacheStorage: 'Cache Storage',
    httpCache: 'Cache HTTP',
    fallbackCode: 'Kode fallback worker',
    network: 'Jaringan melalui worker'
  },
  initiatorTypes: {
    parser: 'Parser',
    script: 'Skrip',
    preload: 'Preload',
    signedexchange: 'Pertukaran bertanda tangan',
    preflight: 'Preflight',
    fedcm: 'FedCM',
    redirect: 'Pengalihan',
    other: 'Lainnya'
  },
  messageDirections: {
    sent: 'terkirim',
    received: 'diterima',
    error: 'error'
  },
  messageKinds: {
    text: 'teks',
    binary: 'biner',
    continuation: 'lanjutan',
    close: 'tutup',
    ping: 'ping',
    pong: 'pong',
    error: 'error',
    unknown: 'tidak dikenal'
  },
  bodyNotes: {
    binary: 'Body biner dihilangkan.',
    multipart: 'Body multipart dihilangkan.',
    unsafeJson: 'Body JSON dihilangkan karena tidak dapat disamarkan dengan aman.',
    nonText: 'Body non-teks dihilangkan.'
  },
  bodyReasons: {
    eventStream: 'Server-sent event tersedia di bagian Stream event yang dibatasi.',
    webSocket: 'Pesan WebSocket tersedia di bagian pesan yang dibatasi.',
    expired: 'Body respons sudah tidak tersedia dari Chromium.',
    incomplete: 'Body respons belum selesai.',
    devToolsCapture: 'Pengambilan mendetail tidak tersedia saat Alat Developer menguasai tab ini.',
    omittedFromExport: 'Body respons dihilangkan dari ekspor yang telah dibersihkan ini.',
    closeDevTools: 'Tutup Alat Developer untuk tab ini, lalu minta lagi detail ini.',
    evicted: 'Chromium sudah tidak menyimpan body respons ini di buffer diagnostiknya yang dibatasi.'
  },
  searchFields: {
    error: 'Error permintaan',
    message: 'Pesan {kind} {direction}',
    event: 'Event {name}'
  }
}

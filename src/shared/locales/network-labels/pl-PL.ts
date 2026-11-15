export const plPLNetworkLabels = {
  resourceTypes: {
    document: 'Dokument',
    stylesheet: 'Arkusz stylów',
    image: 'Obraz',
    media: 'Multimedia',
    font: 'Czcionka',
    script: 'Skrypt',
    texttrack: 'Ścieżka tekstowa',
    xhr: 'XHR',
    fetch: 'Fetch',
    prefetch: 'Prefetch',
    eventsource: 'EventSource',
    websocket: 'WebSocket',
    manifest: 'Manifest',
    signedexchange: 'Podpisana wymiana',
    ping: 'Ping',
    cspviolationreport: 'Raport naruszenia CSP',
    preflight: 'Preflight',
    fedcm: 'FedCM',
    other: 'Inne'
  },
  responseSources: {
    network: 'Sieć',
    serviceWorker: 'Service worker',
    prefetchCache: 'Pamięć podręczna prefetch',
    diskCache: 'Pamięć podręczna dysku',
    otherCache: 'Pamięć podręczna przeglądarki'
  },
  workerSources: {
    cacheStorage: 'Cache Storage',
    httpCache: 'Pamięć podręczna HTTP',
    fallbackCode: 'Kod zastępczy workera',
    network: 'Sieć przez workera'
  },
  initiatorTypes: {
    parser: 'Parser',
    script: 'Skrypt',
    preload: 'Preload',
    signedexchange: 'Podpisana wymiana',
    preflight: 'Preflight',
    fedcm: 'FedCM',
    redirect: 'Przekierowanie',
    other: 'Inne'
  },
  messageDirections: {
    sent: 'wysłano',
    received: 'odebrano',
    error: 'błąd'
  },
  messageKinds: {
    text: 'tekst',
    binary: 'binarny',
    continuation: 'kontynuacja',
    close: 'zamknięcie',
    ping: 'ping',
    pong: 'pong',
    error: 'błąd',
    unknown: 'nieznany'
  },
  bodyNotes: {
    binary: 'Pominięto treść binarną.',
    multipart: 'Pominięto treść multipart.',
    unsafeJson: 'Pominięto treść JSON, bo nie dało się jej bezpiecznie oczyścić.',
    nonText: 'Pominięto treść, która nie jest tekstem.'
  },
  bodyReasons: {
    eventStream: 'Zdarzenia wysyłane przez serwer są w ograniczonej sekcji „Strumień zdarzeń”.',
    webSocket: 'Wiadomości WebSocket są w ograniczonej sekcji „Wiadomości”.',
    expired: 'Chromium nie udostępnia już treści odpowiedzi.',
    incomplete: 'Treść odpowiedzi nie jest jeszcze kompletna.',
    devToolsCapture: 'Szczegółowe przechwytywanie było niedostępne, gdy narzędzia deweloperskie zajmowały tę kartę.',
    omittedFromExport: 'Treść odpowiedzi pominięto w tym oczyszczonym eksporcie.',
    closeDevTools: 'Zamknij narzędzia deweloperskie tej karty, a potem ponownie poproś o te szczegóły.',
    evicted: 'Chromium nie ma już tej treści odpowiedzi w swoim ograniczonym buforze diagnostycznym.'
  },
  searchFields: {
    error: 'Błąd żądania',
    message: 'Wiadomość ({direction}, {kind})',
    event: 'Zdarzenie {name}'
  }
}

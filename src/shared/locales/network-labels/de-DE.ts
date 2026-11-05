export const deDENetworkLabels = {
  resourceTypes: {
    document: 'Dokument',
    stylesheet: 'Stylesheet',
    image: 'Bild',
    media: 'Medien',
    font: 'Schriftart',
    script: 'Skript',
    texttrack: 'Textspur',
    xhr: 'XHR',
    fetch: 'Fetch',
    prefetch: 'Vorabruf',
    eventsource: 'EventSource',
    websocket: 'WebSocket',
    manifest: 'Manifest',
    signedexchange: 'Signed Exchange',
    ping: 'Ping',
    cspviolationreport: 'CSP-Verstoßbericht',
    preflight: 'Preflight',
    fedcm: 'FedCM',
    other: 'Andere'
  },
  responseSources: {
    network: 'Netzwerk',
    serviceWorker: 'Service Worker',
    prefetchCache: 'Vorabruf-Cache',
    diskCache: 'Festplatten-Cache',
    otherCache: 'Browser-Cache'
  },
  workerSources: {
    cacheStorage: 'Cache Storage',
    httpCache: 'HTTP-Cache',
    fallbackCode: 'Ersatzcode des Workers',
    network: 'Netzwerk über den Worker'
  },
  initiatorTypes: {
    parser: 'Parser',
    script: 'Skript',
    preload: 'Preload',
    signedexchange: 'Signed Exchange',
    preflight: 'Preflight',
    fedcm: 'FedCM',
    redirect: 'Umleitung',
    other: 'Andere'
  },
  messageDirections: {
    sent: 'gesendet',
    received: 'empfangen',
    error: 'Fehler'
  },
  messageKinds: {
    text: 'Text',
    binary: 'binär',
    continuation: 'Fortsetzung',
    close: 'Schließen',
    ping: 'Ping',
    pong: 'Pong',
    error: 'Fehler',
    unknown: 'unbekannt'
  },
  bodyNotes: {
    binary: 'Binärer Inhalt ausgelassen.',
    multipart: 'Multipart-Inhalt ausgelassen.',
    unsafeJson: 'JSON-Inhalt ausgelassen, weil er sich nicht sicher bereinigen ließ.',
    nonText: 'Nicht-Text-Inhalt ausgelassen.'
  },
  bodyReasons: {
    eventStream: 'Server-Sent Events stehen im begrenzten Abschnitt „Ereignisstrom“.',
    webSocket: 'WebSocket-Nachrichten stehen im begrenzten Abschnitt „Nachrichten“.',
    expired: 'Chromium stellt den Antworttext nicht mehr bereit.',
    incomplete: 'Der Antworttext ist noch nicht vollständig.',
    devToolsCapture: 'Die detaillierte Erfassung war nicht verfügbar, während die Entwicklertools diesen Tab belegten.',
    omittedFromExport: 'Der Antworttext wurde in diesem bereinigten Export ausgelassen.',
    closeDevTools: 'Schließe die Entwicklertools für diesen Tab und fordere diese Details dann erneut an.',
    evicted: 'Chromium hat diesen Antworttext nicht mehr in seinem begrenzten Diagnosepuffer.'
  },
  searchFields: {
    error: 'Anfragefehler',
    message: 'Nachricht ({direction}, {kind})',
    event: 'Ereignis {name}'
  }
}

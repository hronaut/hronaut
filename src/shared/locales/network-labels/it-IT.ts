export const itITNetworkLabels = {
  resourceTypes: {
    document: 'Documento',
    stylesheet: 'Foglio di stile',
    image: 'Immagine',
    media: 'Contenuti multimediali',
    font: 'Carattere',
    script: 'Script',
    texttrack: 'Traccia di testo',
    xhr: 'XHR',
    fetch: 'Fetch',
    prefetch: 'Prefetch',
    eventsource: 'EventSource',
    websocket: 'WebSocket',
    manifest: 'Manifest',
    signedexchange: 'Scambio firmato',
    ping: 'Ping',
    cspviolationreport: 'Report di violazione CSP',
    preflight: 'Preflight',
    fedcm: 'FedCM',
    other: 'Altro'
  },
  responseSources: {
    network: 'Rete',
    serviceWorker: 'Service worker',
    prefetchCache: 'Cache di prefetch',
    diskCache: 'Cache su disco',
    otherCache: 'Cache del browser'
  },
  workerSources: {
    cacheStorage: 'Cache Storage',
    httpCache: 'Cache HTTP',
    fallbackCode: 'Codice di fallback del worker',
    network: 'Rete tramite worker'
  },
  initiatorTypes: {
    parser: 'Parser',
    script: 'Script',
    preload: 'Precaricamento',
    signedexchange: 'Scambio firmato',
    preflight: 'Preflight',
    fedcm: 'FedCM',
    redirect: 'Reindirizzamento',
    other: 'Altro'
  },
  messageDirections: {
    sent: 'inviato',
    received: 'ricevuto',
    error: 'errore'
  },
  messageKinds: {
    text: 'testo',
    binary: 'binario',
    continuation: 'continuazione',
    close: 'chiusura',
    ping: 'ping',
    pong: 'pong',
    error: 'errore',
    unknown: 'sconosciuto'
  },
  bodyNotes: {
    binary: 'Corpo binario omesso.',
    multipart: 'Corpo multipart omesso.',
    unsafeJson: 'Corpo JSON omesso perché non è stato possibile oscurarlo in modo sicuro.',
    nonText: 'Corpo non testuale omesso.'
  },
  bodyReasons: {
    eventStream: 'Gli eventi inviati dal server sono disponibili nella sezione limitata Flusso di eventi.',
    webSocket: 'I messaggi WebSocket sono disponibili nella sezione limitata Messaggi.',
    expired: 'Il corpo della risposta non è più disponibile in Chromium.',
    incomplete: 'Il corpo della risposta non è ancora completo.',
    devToolsCapture: 'L’acquisizione dettagliata non era disponibile mentre gli Strumenti per sviluppatori controllavano questa scheda.',
    omittedFromExport: 'Il corpo della risposta è stato omesso da questa esportazione ripulita.',
    closeDevTools: 'Chiudi gli Strumenti per sviluppatori per questa scheda, quindi richiedi di nuovo questi dettagli.',
    evicted: 'Chromium non ha più il corpo di questa risposta nel suo buffer diagnostico limitato.'
  },
  searchFields: {
    error: 'Errore della richiesta',
    message: 'Messaggio {kind} {direction}',
    event: 'Evento {name}'
  }
}

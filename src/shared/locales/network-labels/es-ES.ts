export const esESNetworkLabels = {
  resourceTypes: {
    document: 'Documento',
    stylesheet: 'Hoja de estilos',
    image: 'Imagen',
    media: 'Multimedia',
    font: 'Fuente',
    script: 'Script',
    texttrack: 'Pista de texto',
    xhr: 'XHR',
    fetch: 'Fetch',
    prefetch: 'Prefetch',
    eventsource: 'EventSource',
    websocket: 'WebSocket',
    manifest: 'Manifiesto',
    signedexchange: 'Intercambio firmado',
    ping: 'Ping',
    cspviolationreport: 'Informe de infracción de CSP',
    preflight: 'Preflight',
    fedcm: 'FedCM',
    other: 'Otro'
  },
  responseSources: {
    network: 'Red',
    serviceWorker: 'Service worker',
    prefetchCache: 'Caché de prefetch',
    diskCache: 'Caché de disco',
    otherCache: 'Caché del navegador'
  },
  workerSources: {
    cacheStorage: 'Cache Storage',
    httpCache: 'Caché HTTP',
    fallbackCode: 'Código alternativo del worker',
    network: 'Red a través del worker'
  },
  initiatorTypes: {
    parser: 'Analizador',
    script: 'Script',
    preload: 'Precarga',
    signedexchange: 'Intercambio firmado',
    preflight: 'Preflight',
    fedcm: 'FedCM',
    redirect: 'Redirección',
    other: 'Otro'
  },
  messageDirections: {
    sent: 'enviado',
    received: 'recibido',
    error: 'error'
  },
  messageKinds: {
    text: 'texto',
    binary: 'binario',
    continuation: 'continuación',
    close: 'cierre',
    ping: 'ping',
    pong: 'pong',
    error: 'error',
    unknown: 'desconocido'
  },
  bodyNotes: {
    binary: 'Cuerpo binario omitido.',
    multipart: 'Cuerpo multipart omitido.',
    unsafeJson: 'Cuerpo JSON omitido porque no se pudo depurar de forma segura.',
    nonText: 'Cuerpo no textual omitido.'
  },
  bodyReasons: {
    eventStream: 'Los eventos enviados por el servidor están en la sección limitada «Flujo de eventos».',
    webSocket: 'Los mensajes de WebSocket están en la sección limitada «Mensajes».',
    expired: 'Chromium ya no ofrece el cuerpo de la respuesta.',
    incomplete: 'El cuerpo de la respuesta aún no se ha completado.',
    devToolsCapture: 'La captura detallada no estaba disponible mientras las herramientas de desarrollo controlaban esta pestaña.',
    omittedFromExport: 'El cuerpo de la respuesta se omitió de esta exportación depurada.',
    closeDevTools: 'Cierra las herramientas de desarrollo de esta pestaña y vuelve a solicitar estos detalles.',
    evicted: 'Chromium ya no conserva este cuerpo de respuesta en su búfer de diagnóstico limitado.'
  },
  searchFields: {
    error: 'Error de la solicitud',
    message: 'Mensaje ({direction}, {kind})',
    event: 'Evento {name}'
  }
}

// Names for the Chromium codes and Hronaut's English notes the Network panel
// shows. Filters, HAR files and MCP results keep the codes and the English text
// from src/shared.
export const enUSNetworkLabels = {
  resourceTypes: {
    document: 'Document',
    stylesheet: 'Stylesheet',
    image: 'Image',
    media: 'Media',
    font: 'Font',
    script: 'Script',
    texttrack: 'Text track',
    xhr: 'XHR',
    fetch: 'Fetch',
    prefetch: 'Prefetch',
    eventsource: 'EventSource',
    websocket: 'WebSocket',
    manifest: 'Manifest',
    signedexchange: 'Signed exchange',
    ping: 'Ping',
    cspviolationreport: 'CSP violation report',
    preflight: 'Preflight',
    fedcm: 'FedCM',
    other: 'Other'
  },
  responseSources: {
    network: 'Network',
    serviceWorker: 'Service worker',
    prefetchCache: 'Prefetch cache',
    diskCache: 'Disk cache',
    otherCache: 'Browser cache'
  },
  workerSources: {
    cacheStorage: 'Cache Storage',
    httpCache: 'HTTP cache',
    fallbackCode: 'Worker fallback code',
    network: 'Network through worker'
  },
  initiatorTypes: {
    parser: 'Parser',
    script: 'Script',
    preload: 'Preload',
    signedexchange: 'Signed exchange',
    preflight: 'Preflight',
    fedcm: 'FedCM',
    redirect: 'Redirect',
    other: 'Other'
  },
  messageDirections: {
    sent: 'sent',
    received: 'received',
    error: 'error'
  },
  messageKinds: {
    text: 'text',
    binary: 'binary',
    continuation: 'continuation',
    close: 'close',
    ping: 'ping',
    pong: 'pong',
    error: 'error',
    unknown: 'unknown'
  },
  bodyNotes: {
    binary: 'Binary body omitted.',
    multipart: 'Multipart body omitted.',
    unsafeJson: 'JSON body omitted because it could not be safely redacted.',
    nonText: 'Non-text body omitted.'
  },
  bodyReasons: {
    eventStream: 'Server-sent events are available in the bounded Event stream section.',
    webSocket: 'WebSocket messages are available in the bounded messages section.',
    expired: 'Response body is no longer available from Chromium.',
    incomplete: 'The response body has not completed.',
    devToolsCapture: 'Detailed capture was unavailable while Developer Tools owned this tab.',
    omittedFromExport: 'Response body was omitted from this sanitized export.',
    closeDevTools: 'Close Developer Tools for this tab, then request these details again.',
    evicted: 'Chromium no longer has this response body in its bounded diagnostic buffer.'
  },
  searchFields: {
    error: 'Request error',
    message: '{direction} {kind} message',
    event: '{name} event'
  }
}

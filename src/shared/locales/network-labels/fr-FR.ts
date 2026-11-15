export const frFRNetworkLabels = {
  resourceTypes: {
    document: 'Document',
    stylesheet: 'Feuille de style',
    image: 'Image',
    media: 'Média',
    font: 'Police',
    script: 'Script',
    texttrack: 'Piste de texte',
    xhr: 'XHR',
    fetch: 'Fetch',
    prefetch: 'Prélecture',
    eventsource: 'EventSource',
    websocket: 'WebSocket',
    manifest: 'Manifeste',
    signedexchange: 'Échange signé',
    ping: 'Ping',
    cspviolationreport: 'Rapport de violation CSP',
    preflight: 'Preflight',
    fedcm: 'FedCM',
    other: 'Autre'
  },
  responseSources: {
    network: 'Réseau',
    serviceWorker: 'Service worker',
    prefetchCache: 'Cache de prélecture',
    diskCache: 'Cache disque',
    otherCache: 'Cache du navigateur'
  },
  workerSources: {
    cacheStorage: 'Cache Storage',
    httpCache: 'Cache HTTP',
    fallbackCode: 'Code de secours du worker',
    network: 'Réseau via le worker'
  },
  initiatorTypes: {
    parser: 'Analyseur',
    script: 'Script',
    preload: 'Préchargement',
    signedexchange: 'Échange signé',
    preflight: 'Preflight',
    fedcm: 'FedCM',
    redirect: 'Redirection',
    other: 'Autre'
  },
  messageDirections: {
    sent: 'envoyé',
    received: 'reçu',
    error: 'erreur'
  },
  messageKinds: {
    text: 'texte',
    binary: 'binaire',
    continuation: 'continuation',
    close: 'fermeture',
    ping: 'ping',
    pong: 'pong',
    error: 'erreur',
    unknown: 'inconnu'
  },
  bodyNotes: {
    binary: 'Corps binaire omis.',
    multipart: 'Corps multipart omis.',
    unsafeJson: 'Corps JSON omis, car il n’a pas pu être nettoyé en toute sécurité.',
    nonText: 'Corps non textuel omis.'
  },
  bodyReasons: {
    eventStream: 'Les événements envoyés par le serveur figurent dans la section limitée « Flux d’événements ».',
    webSocket: 'Les messages WebSocket figurent dans la section limitée « Messages ».',
    expired: 'Chromium ne fournit plus le corps de la réponse.',
    incomplete: 'Le corps de la réponse n’est pas encore complet.',
    devToolsCapture: 'La capture détaillée était indisponible pendant que les outils de développement contrôlaient cet onglet.',
    omittedFromExport: 'Le corps de la réponse a été omis de cet export nettoyé.',
    closeDevTools: 'Fermez les outils de développement de cet onglet, puis demandez de nouveau ces détails.',
    evicted: 'Chromium ne conserve plus ce corps de réponse dans son tampon de diagnostic limité.'
  },
  searchFields: {
    error: 'Erreur de la requête',
    message: 'Message ({direction}, {kind})',
    event: 'Événement {name}'
  }
}

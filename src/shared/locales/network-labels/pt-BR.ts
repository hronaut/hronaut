export const ptBRNetworkLabels = {
  resourceTypes: {
    document: 'Documento',
    stylesheet: 'Folha de estilo',
    image: 'Imagem',
    media: 'Mídia',
    font: 'Fonte',
    script: 'Script',
    texttrack: 'Faixa de texto',
    xhr: 'XHR',
    fetch: 'Fetch',
    prefetch: 'Pré-busca',
    eventsource: 'EventSource',
    websocket: 'WebSocket',
    manifest: 'Manifesto',
    signedexchange: 'Troca assinada (SXG)',
    ping: 'Ping',
    cspviolationreport: 'Relatório de violação de CSP',
    preflight: 'Preflight',
    fedcm: 'FedCM',
    other: 'Outro'
  },
  responseSources: {
    network: 'Rede',
    serviceWorker: 'Service worker',
    prefetchCache: 'Cache de pré-busca',
    diskCache: 'Cache em disco',
    otherCache: 'Cache do navegador'
  },
  workerSources: {
    cacheStorage: 'Cache Storage',
    httpCache: 'Cache HTTP',
    fallbackCode: 'Código alternativo do worker',
    network: 'Rede via worker'
  },
  initiatorTypes: {
    parser: 'Analisador',
    script: 'Script',
    preload: 'Pré-carregamento',
    signedexchange: 'Troca assinada (SXG)',
    preflight: 'Preflight',
    fedcm: 'FedCM',
    redirect: 'Redirecionamento',
    other: 'Outro'
  },
  messageDirections: {
    sent: 'enviada',
    received: 'recebida',
    error: 'com erro'
  },
  messageKinds: {
    text: 'texto',
    binary: 'binária',
    continuation: 'continuação',
    close: 'fechamento',
    ping: 'ping',
    pong: 'pong',
    error: 'erro',
    unknown: 'desconhecido'
  },
  bodyNotes: {
    binary: 'Corpo binário omitido.',
    multipart: 'Corpo multipart omitido.',
    unsafeJson: 'Corpo JSON omitido porque não pôde ser ocultado com segurança.',
    nonText: 'Corpo não textual omitido.'
  },
  bodyReasons: {
    eventStream: 'Os eventos enviados pelo servidor estão disponíveis na seção limitada Fluxo de eventos.',
    webSocket: 'As mensagens de WebSocket estão disponíveis na seção limitada de mensagens.',
    expired: 'O corpo da resposta não está mais disponível no Chromium.',
    incomplete: 'O corpo da resposta ainda não foi concluído.',
    devToolsCapture: 'A captura detalhada não estava disponível enquanto as Ferramentas do desenvolvedor controlavam esta guia.',
    omittedFromExport: 'O corpo da resposta foi omitido desta exportação sanitizada.',
    closeDevTools: 'Feche as Ferramentas do desenvolvedor desta guia e solicite estes detalhes novamente.',
    evicted: 'O Chromium não tem mais este corpo de resposta no buffer de diagnóstico limitado.'
  },
  searchFields: {
    error: 'Erro da solicitação',
    message: 'Mensagem {direction} ({kind})',
    event: 'Evento {name}'
  }
}

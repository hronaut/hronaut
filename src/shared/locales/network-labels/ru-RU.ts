export const ruRUNetworkLabels = {
  resourceTypes: {
    document: 'Документ',
    stylesheet: 'Таблица стилей',
    image: 'Изображение',
    media: 'Медиа',
    font: 'Шрифт',
    script: 'Скрипт',
    texttrack: 'Текстовая дорожка',
    xhr: 'XHR',
    fetch: 'Fetch',
    prefetch: 'Предварительная загрузка',
    eventsource: 'EventSource',
    websocket: 'WebSocket',
    manifest: 'Манифест',
    signedexchange: 'Подписанный обмен',
    ping: 'Ping',
    cspviolationreport: 'Отчёт о нарушении CSP',
    preflight: 'Preflight',
    fedcm: 'FedCM',
    other: 'Другое'
  },
  responseSources: {
    network: 'Сеть',
    serviceWorker: 'Service worker',
    prefetchCache: 'Кеш предварительной загрузки',
    diskCache: 'Дисковый кеш',
    otherCache: 'Кеш браузера'
  },
  workerSources: {
    cacheStorage: 'Cache Storage',
    httpCache: 'HTTP-кеш',
    fallbackCode: 'Резервный код worker',
    network: 'Сеть через worker'
  },
  initiatorTypes: {
    parser: 'Парсер',
    script: 'Скрипт',
    preload: 'Preload',
    signedexchange: 'Подписанный обмен',
    preflight: 'Preflight',
    fedcm: 'FedCM',
    redirect: 'Перенаправление',
    other: 'Другое'
  },
  messageDirections: {
    sent: 'отправлено',
    received: 'получено',
    error: 'ошибка'
  },
  messageKinds: {
    text: 'текст',
    binary: 'двоичный',
    continuation: 'продолжение',
    close: 'закрытие',
    ping: 'ping',
    pong: 'pong',
    error: 'ошибка',
    unknown: 'неизвестный'
  },
  bodyNotes: {
    binary: 'Двоичное тело исключено.',
    multipart: 'Тело multipart исключено.',
    unsafeJson: 'Тело JSON исключено, так как его не удалось безопасно очистить.',
    nonText: 'Нетекстовое тело исключено.'
  },
  bodyReasons: {
    eventStream: 'События, отправленные сервером, находятся в ограниченном разделе «Поток событий».',
    webSocket: 'Сообщения WebSocket находятся в ограниченном разделе «Сообщения».',
    expired: 'Chromium больше не предоставляет тело ответа.',
    incomplete: 'Тело ответа ещё не получено полностью.',
    devToolsCapture: 'Подробный захват был недоступен, пока инструменты разработчика занимали эту вкладку.',
    omittedFromExport: 'Тело ответа исключено из этого очищенного экспорта.',
    closeDevTools: 'Закройте инструменты разработчика для этой вкладки, а затем снова запросите эти сведения.',
    evicted: 'Chromium больше не хранит это тело ответа в своём ограниченном диагностическом буфере.'
  },
  searchFields: {
    error: 'Ошибка запроса',
    message: 'Сообщение ({direction}, {kind})',
    event: 'Событие {name}'
  }
}

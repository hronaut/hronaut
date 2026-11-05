export const ukUANetworkLabels = {
  resourceTypes: {
    document: 'Документ',
    stylesheet: 'Таблиця стилів',
    image: 'Зображення',
    media: 'Медіа',
    font: 'Шрифт',
    script: 'Скрипт',
    texttrack: 'Текстова доріжка',
    xhr: 'XHR',
    fetch: 'Fetch',
    prefetch: 'Попереднє завантаження',
    eventsource: 'EventSource',
    websocket: 'WebSocket',
    manifest: 'Маніфест',
    signedexchange: 'Підписаний обмін',
    ping: 'Ping',
    cspviolationreport: 'Звіт про порушення CSP',
    preflight: 'Preflight',
    fedcm: 'FedCM',
    other: 'Інше'
  },
  responseSources: {
    network: 'Мережа',
    serviceWorker: 'Service worker',
    prefetchCache: 'Кеш попереднього завантаження',
    diskCache: 'Дисковий кеш',
    otherCache: 'Кеш браузера'
  },
  workerSources: {
    cacheStorage: 'Cache Storage',
    httpCache: 'HTTP-кеш',
    fallbackCode: 'Резервний код воркера',
    network: 'Мережа через воркер'
  },
  initiatorTypes: {
    parser: 'Парсер',
    script: 'Скрипт',
    preload: 'Preload',
    signedexchange: 'Підписаний обмін',
    preflight: 'Preflight',
    fedcm: 'FedCM',
    redirect: 'Переспрямування',
    other: 'Інше'
  },
  messageDirections: {
    sent: 'надіслано',
    received: 'отримано',
    error: 'помилка'
  },
  messageKinds: {
    text: 'текст',
    binary: 'бінарний',
    continuation: 'продовження',
    close: 'закриття',
    ping: 'ping',
    pong: 'pong',
    error: 'помилка',
    unknown: 'невідомий'
  },
  bodyNotes: {
    binary: 'Бінарне тіло виключено.',
    multipart: 'Тіло multipart виключено.',
    unsafeJson: 'Тіло JSON виключено, бо його не вдалося безпечно очистити.',
    nonText: 'Нетекстове тіло виключено.'
  },
  bodyReasons: {
    eventStream: 'Події, надіслані сервером, доступні в обмеженому розділі «Потік подій».',
    webSocket: 'Повідомлення WebSocket доступні в обмеженому розділі «Повідомлення».',
    expired: 'Chromium більше не надає тіло відповіді.',
    incomplete: 'Тіло відповіді ще не отримано повністю.',
    devToolsCapture: 'Докладне захоплення було недоступне, поки інструменти розробника займали цю вкладку.',
    omittedFromExport: 'Тіло відповіді виключено з цього очищеного експорту.',
    closeDevTools: 'Закрийте інструменти розробника для цієї вкладки, а потім знову запросіть ці відомості.',
    evicted: 'Chromium більше не зберігає це тіло відповіді у своєму обмеженому діагностичному буфері.'
  },
  searchFields: {
    error: 'Помилка запиту',
    message: 'Повідомлення ({direction}, {kind})',
    event: 'Подія {name}'
  }
}

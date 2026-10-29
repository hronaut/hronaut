// Names for the Chromium codes and Hronaut's English notes the Network panel
// shows. Filters, HAR files and MCP results keep the codes and the English text
// from src/shared.
export const networkLabelMessages = {
  'en-US': {
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
  },
  'de-DE': {
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
  },
  'es-ES': {
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
  },
  'fr-FR': {
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
  },
  'pl-PL': {
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
  },
  'uk-UA': {
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
  },
  'ru-RU': {
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
  },
  'it-IT': {
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
  },
  'pt-BR': {
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
  },
  'tr-TR': {
    resourceTypes: {
      document: 'Belge',
      stylesheet: 'Stil sayfası',
      image: 'Resim',
      media: 'Medya',
      font: 'Yazı tipi',
      script: 'Komut dosyası',
      texttrack: 'Metin parçası',
      xhr: 'XHR',
      fetch: 'Fetch',
      prefetch: 'Önceden getirme',
      eventsource: 'EventSource',
      websocket: 'WebSocket',
      manifest: 'Manifest',
      signedexchange: 'İmzalı değişim',
      ping: 'Ping',
      cspviolationreport: 'CSP ihlali raporu',
      preflight: 'Ön kontrol',
      fedcm: 'FedCM',
      other: 'Diğer'
    },
    responseSources: {
      network: 'Ağ',
      serviceWorker: 'Service worker',
      prefetchCache: 'Önceden getirme önbelleği',
      diskCache: 'Disk önbelleği',
      otherCache: 'Tarayıcı önbelleği'
    },
    workerSources: {
      cacheStorage: 'Cache Storage',
      httpCache: 'HTTP önbelleği',
      fallbackCode: 'Worker yedek kodu',
      network: 'Worker üzerinden ağ'
    },
    initiatorTypes: {
      parser: 'Ayrıştırıcı',
      script: 'Komut dosyası',
      preload: 'Önceden yükleme',
      signedexchange: 'İmzalı değişim',
      preflight: 'Ön kontrol',
      fedcm: 'FedCM',
      redirect: 'Yönlendirme',
      other: 'Diğer'
    },
    messageDirections: {
      sent: 'gönderilen',
      received: 'alınan',
      error: 'hata'
    },
    messageKinds: {
      text: 'metin',
      binary: 'ikili',
      continuation: 'devam',
      close: 'kapatma',
      ping: 'ping',
      pong: 'pong',
      error: 'hata',
      unknown: 'bilinmeyen'
    },
    bodyNotes: {
      binary: 'İkili gövde çıkarıldı.',
      multipart: 'Çok parçalı gövde çıkarıldı.',
      unsafeJson: 'JSON gövdesi güvenli şekilde gizlenemediği için çıkarıldı.',
      nonText: 'Metin olmayan gövde çıkarıldı.'
    },
    bodyReasons: {
      eventStream: 'Sunucu tarafından gönderilen olaylar, sınırlı Olay akışı bölümünde bulunur.',
      webSocket: 'WebSocket mesajları, sınırlı mesajlar bölümünde bulunur.',
      expired: 'Yanıt gövdesi artık Chromium’da bulunmuyor.',
      incomplete: 'Yanıt gövdesi henüz tamamlanmadı.',
      devToolsCapture: 'Bu sekme Geliştirici araçlarının denetimindeyken ayrıntılı yakalama kullanılamadı.',
      omittedFromExport: 'Yanıt gövdesi bu temizlenmiş dışa aktarımdan çıkarıldı.',
      closeDevTools: 'Bu sekmenin Geliştirici araçlarını kapatın, ardından bu ayrıntıları tekrar isteyin.',
      evicted: 'Chromium’un sınırlı tanılama arabelleğinde bu yanıt gövdesi artık yok.'
    },
    searchFields: {
      error: 'İstek hatası',
      message: '{direction} {kind} mesajı',
      event: '{name} olayı'
    }
  },
  'hi-IN': {
    resourceTypes: {
      document: 'दस्तावेज़',
      stylesheet: 'स्टाइलशीट',
      image: 'इमेज',
      media: 'मीडिया',
      font: 'फ़ॉन्ट',
      script: 'स्क्रिप्ट',
      texttrack: 'टेक्स्ट ट्रैक',
      xhr: 'XHR',
      fetch: 'Fetch',
      prefetch: 'प्रीफ़ेच',
      eventsource: 'EventSource',
      websocket: 'WebSocket',
      manifest: 'मेनिफ़ेस्ट',
      signedexchange: 'साइन किया गया एक्सचेंज',
      ping: 'पिंग',
      cspviolationreport: 'CSP उल्लंघन की रिपोर्ट',
      preflight: 'प्रीफ़्लाइट',
      fedcm: 'FedCM',
      other: 'अन्य'
    },
    responseSources: {
      network: 'नेटवर्क',
      serviceWorker: 'सर्विस वर्कर',
      prefetchCache: 'प्रीफ़ेच कैश',
      diskCache: 'डिस्क कैश',
      otherCache: 'ब्राउज़र कैश'
    },
    workerSources: {
      cacheStorage: 'कैश स्टोरेज',
      httpCache: 'HTTP कैश',
      fallbackCode: 'वर्कर का फ़ॉलबैक कोड',
      network: 'वर्कर के ज़रिए नेटवर्क'
    },
    initiatorTypes: {
      parser: 'पार्सर',
      script: 'स्क्रिप्ट',
      preload: 'प्रीलोड',
      signedexchange: 'साइन किया गया एक्सचेंज',
      preflight: 'प्रीफ़्लाइट',
      fedcm: 'FedCM',
      redirect: 'रीडायरेक्ट',
      other: 'अन्य'
    },
    messageDirections: {
      sent: 'भेजा गया',
      received: 'प्राप्त',
      error: 'गड़बड़ी'
    },
    messageKinds: {
      text: 'टेक्स्ट',
      binary: 'बाइनरी',
      continuation: 'कंटिन्यूएशन',
      close: 'क्लोज़',
      ping: 'पिंग',
      pong: 'पॉन्ग',
      error: 'गड़बड़ी',
      unknown: 'अनजान'
    },
    bodyNotes: {
      binary: 'बाइनरी बॉडी छोड़ दी गई।',
      multipart: 'मल्टीपार्ट बॉडी छोड़ दी गई।',
      unsafeJson: 'JSON बॉडी छोड़ दी गई, क्योंकि इसे सुरक्षित तरीके से छिपाया नहीं जा सका।',
      nonText: 'बिना टेक्स्ट वाली बॉडी छोड़ दी गई।'
    },
    bodyReasons: {
      eventStream: 'सर्वर से भेजे गए इवेंट, सीमित “इवेंट स्ट्रीम” सेक्शन में उपलब्ध हैं।',
      webSocket: 'WebSocket मैसेज, सीमित “मैसेज” सेक्शन में उपलब्ध हैं।',
      expired: 'रिस्पॉन्स बॉडी अब Chromium से उपलब्ध नहीं है।',
      incomplete: 'रिस्पॉन्स बॉडी अभी पूरी नहीं हुई है।',
      devToolsCapture: 'जब इस टैब पर डेवलपर टूल का कंट्रोल था, तब पूरी जानकारी कैप्चर करना उपलब्ध नहीं था।',
      omittedFromExport: 'साफ़ किए गए इस एक्सपोर्ट से रिस्पॉन्स बॉडी छोड़ दी गई।',
      closeDevTools: 'इस टैब के डेवलपर टूल बंद करें, फिर ये जानकारी दोबारा मांगें।',
      evicted: 'Chromium के सीमित डायग्नोस्टिक बफ़र में अब यह रिस्पॉन्स बॉडी नहीं है।'
    },
    searchFields: {
      error: 'अनुरोध की गड़बड़ी',
      message: '{direction} {kind} मैसेज',
      event: '{name} इवेंट'
    }
  },
  'ja-JP': {
    resourceTypes: {
      document: 'ドキュメント',
      stylesheet: 'スタイルシート',
      image: '画像',
      media: 'メディア',
      font: 'フォント',
      script: 'スクリプト',
      texttrack: 'テキスト トラック',
      xhr: 'XHR',
      fetch: 'Fetch',
      prefetch: 'プリフェッチ',
      eventsource: 'EventSource',
      websocket: 'WebSocket',
      manifest: 'マニフェスト',
      signedexchange: '署名付き交換',
      ping: 'Ping',
      cspviolationreport: 'CSP 違反レポート',
      preflight: 'プリフライト',
      fedcm: 'FedCM',
      other: 'その他'
    },
    responseSources: {
      network: 'ネットワーク',
      serviceWorker: 'Service Worker',
      prefetchCache: 'プリフェッチ キャッシュ',
      diskCache: 'ディスク キャッシュ',
      otherCache: 'ブラウザ キャッシュ'
    },
    workerSources: {
      cacheStorage: 'Cache Storage',
      httpCache: 'HTTP キャッシュ',
      fallbackCode: 'ワーカーのフォールバック コード',
      network: 'ワーカー経由のネットワーク'
    },
    initiatorTypes: {
      parser: 'パーサー',
      script: 'スクリプト',
      preload: 'プリロード',
      signedexchange: '署名付き交換',
      preflight: 'プリフライト',
      fedcm: 'FedCM',
      redirect: 'リダイレクト',
      other: 'その他'
    },
    messageDirections: {
      sent: '送信',
      received: '受信',
      error: 'エラー'
    },
    messageKinds: {
      text: 'テキスト',
      binary: 'バイナリ',
      continuation: '継続',
      close: 'クローズ',
      ping: 'ping',
      pong: 'pong',
      error: 'エラー',
      unknown: '不明'
    },
    bodyNotes: {
      binary: 'バイナリの本文は除外されました。',
      multipart: 'マルチパートの本文は除外されました。',
      unsafeJson: '安全に秘匿化できなかったため、JSON の本文は除外されました。',
      nonText: 'テキスト以外の本文は除外されました。'
    },
    bodyReasons: {
      eventStream: 'サーバー送信イベントは、範囲を限定した [イベント ストリーム] セクションで確認できます。',
      webSocket: 'WebSocket のメッセージは、範囲を限定した [メッセージ] セクションで確認できます。',
      expired: 'レスポンスの本文は Chromium から取得できなくなりました。',
      incomplete: 'レスポンスの本文はまだ完了していません。',
      devToolsCapture: 'デベロッパー ツールがこのタブを使用している間は、詳細な取得を利用できませんでした。',
      omittedFromExport: 'このサニタイズ済みのエクスポートでは、レスポンスの本文は除外されました。',
      closeDevTools: 'このタブのデベロッパー ツールを閉じてから、もう一度これらの詳細をリクエストしてください。',
      evicted: 'Chromium の範囲を限定した診断バッファには、このレスポンスの本文はもうありません。'
    },
    searchFields: {
      error: 'リクエストのエラー',
      message: '{kind}メッセージ（{direction}）',
      event: '{name} イベント'
    }
  },
  'ko-KR': {
    resourceTypes: {
      document: '문서',
      stylesheet: '스타일시트',
      image: '이미지',
      media: '미디어',
      font: '글꼴',
      script: '스크립트',
      texttrack: '텍스트 트랙',
      xhr: 'XHR',
      fetch: 'Fetch',
      prefetch: '프리페치',
      eventsource: 'EventSource',
      websocket: 'WebSocket',
      manifest: '매니페스트',
      signedexchange: '서명된 교환',
      ping: '핑',
      cspviolationreport: 'CSP 위반 보고서',
      preflight: '프리플라이트',
      fedcm: 'FedCM',
      other: '기타'
    },
    responseSources: {
      network: '네트워크',
      serviceWorker: '서비스 워커',
      prefetchCache: '프리페치 캐시',
      diskCache: '디스크 캐시',
      otherCache: '브라우저 캐시'
    },
    workerSources: {
      cacheStorage: '캐시 저장소',
      httpCache: 'HTTP 캐시',
      fallbackCode: '워커 대체 코드',
      network: '워커를 통한 네트워크'
    },
    initiatorTypes: {
      parser: '파서',
      script: '스크립트',
      preload: '미리 로드',
      signedexchange: '서명된 교환',
      preflight: '프리플라이트',
      fedcm: 'FedCM',
      redirect: '리디렉션',
      other: '기타'
    },
    messageDirections: {
      sent: '보냄',
      received: '받음',
      error: '오류'
    },
    messageKinds: {
      text: '텍스트',
      binary: '바이너리',
      continuation: '연속',
      close: '닫기',
      ping: '핑',
      pong: '퐁',
      error: '오류',
      unknown: '알 수 없음'
    },
    bodyNotes: {
      binary: '바이너리 본문은 생략되었습니다.',
      multipart: '멀티파트 본문은 생략되었습니다.',
      unsafeJson: 'JSON 본문을 안전하게 가릴 수 없어 생략했습니다.',
      nonText: '텍스트가 아닌 본문은 생략되었습니다.'
    },
    bodyReasons: {
      eventStream: '서버 전송 이벤트는 크기가 제한된 이벤트 스트림 섹션에서 볼 수 있습니다.',
      webSocket: 'WebSocket 메시지는 크기가 제한된 메시지 섹션에서 볼 수 있습니다.',
      expired: 'Chromium에서 더 이상 응답 본문을 가져올 수 없습니다.',
      incomplete: '응답 본문이 아직 완료되지 않았습니다.',
      devToolsCapture: '개발자 도구가 이 탭을 사용하는 동안에는 상세 캡처를 사용할 수 없었습니다.',
      omittedFromExport: '정리된 이 내보내기에서는 응답 본문이 생략되었습니다.',
      closeDevTools: '이 탭의 개발자 도구를 닫은 후 세부정보를 다시 요청하세요.',
      evicted: 'Chromium의 크기가 제한된 진단 버퍼에 이 응답 본문이 더 이상 없습니다.'
    },
    searchFields: {
      error: '요청 오류',
      message: '{direction} {kind} 메시지',
      event: '{name} 이벤트'
    }
  },
  'zh-CN': {
    resourceTypes: {
      document: '文档',
      stylesheet: '样式表',
      image: '图片',
      media: '媒体',
      font: '字体',
      script: '脚本',
      texttrack: '文本轨道',
      xhr: 'XHR',
      fetch: 'Fetch',
      prefetch: '预提取',
      eventsource: 'EventSource',
      websocket: 'WebSocket',
      manifest: '清单',
      signedexchange: 'Signed Exchange',
      ping: 'Ping',
      cspviolationreport: 'CSP 违规报告',
      preflight: '预检',
      fedcm: 'FedCM',
      other: '其他'
    },
    responseSources: {
      network: '网络',
      serviceWorker: 'Service Worker',
      prefetchCache: '预提取缓存',
      diskCache: '磁盘缓存',
      otherCache: '浏览器缓存'
    },
    workerSources: {
      cacheStorage: '缓存存储',
      httpCache: 'HTTP 缓存',
      fallbackCode: 'Worker 后备代码',
      network: '经由 Worker 的网络'
    },
    initiatorTypes: {
      parser: '解析器',
      script: '脚本',
      preload: '预加载',
      signedexchange: 'Signed Exchange',
      preflight: '预检',
      fedcm: 'FedCM',
      redirect: '重定向',
      other: '其他'
    },
    messageDirections: {
      sent: '已发送',
      received: '已接收',
      error: '错误'
    },
    messageKinds: {
      text: '文本',
      binary: '二进制',
      continuation: '延续',
      close: '关闭',
      ping: 'ping',
      pong: 'pong',
      error: '错误',
      unknown: '未知'
    },
    bodyNotes: {
      binary: '已省略二进制正文。',
      multipart: '已省略 multipart 正文。',
      unsafeJson: '由于无法安全地隐去敏感内容，已省略 JSON 正文。',
      nonText: '已省略非文本正文。'
    },
    bodyReasons: {
      eventStream: '服务器发送的事件可在有限的“事件流”部分中查看。',
      webSocket: 'WebSocket 消息可在有限的“消息”部分中查看。',
      expired: 'Chromium 已不再提供响应正文。',
      incomplete: '响应正文尚未完成。',
      devToolsCapture: '开发者工具占用此标签页期间，无法进行详细捕获。',
      omittedFromExport: '此已脱敏的导出中省略了响应正文。',
      closeDevTools: '请关闭此标签页的开发者工具，然后重新请求这些详细信息。',
      evicted: 'Chromium 的有限诊断缓冲区中已不再保留此响应正文。'
    },
    searchFields: {
      error: '请求错误',
      message: '{direction}的{kind}消息',
      event: '{name} 事件'
    }
  },
  'zh-TW': {
    resourceTypes: {
      document: '文件',
      stylesheet: '樣式表',
      image: '圖片',
      media: '媒體',
      font: '字型',
      script: '指令碼',
      texttrack: '文字軌',
      xhr: 'XHR',
      fetch: 'Fetch',
      prefetch: '預先擷取',
      eventsource: 'EventSource',
      websocket: 'WebSocket',
      manifest: '資訊清單',
      signedexchange: '已簽署交換',
      ping: 'Ping',
      cspviolationreport: 'CSP 違規報告',
      preflight: '預檢',
      fedcm: 'FedCM',
      other: '其他'
    },
    responseSources: {
      network: '網路',
      serviceWorker: 'Service Worker',
      prefetchCache: '預先擷取快取',
      diskCache: '磁碟快取',
      otherCache: '瀏覽器快取'
    },
    workerSources: {
      cacheStorage: '快取儲存空間',
      httpCache: 'HTTP 快取',
      fallbackCode: 'Worker 備援程式碼',
      network: '透過 Worker 的網路'
    },
    initiatorTypes: {
      parser: '剖析器',
      script: '指令碼',
      preload: '預先載入',
      signedexchange: '已簽署交換',
      preflight: '預檢',
      fedcm: 'FedCM',
      redirect: '重新導向',
      other: '其他'
    },
    messageDirections: {
      sent: '已傳送',
      received: '已接收',
      error: '錯誤'
    },
    messageKinds: {
      text: '文字',
      binary: '二進位',
      continuation: '接續',
      close: '關閉',
      ping: 'ping',
      pong: 'pong',
      error: '錯誤',
      unknown: '不明'
    },
    bodyNotes: {
      binary: '已省略二進位內文。',
      multipart: '已省略多部分內文。',
      unsafeJson: 'JSON 內文無法安全遮蓋，因此已省略。',
      nonText: '已省略非文字內文。'
    },
    bodyReasons: {
      eventStream: '伺服器推送事件可在有長度上限的「事件串流」區段中查看。',
      webSocket: 'WebSocket 訊息可在有長度上限的訊息區段中查看。',
      expired: 'Chromium 已無法再提供回應內文。',
      incomplete: '回應內文尚未完成。',
      devToolsCapture: '開發人員工具控制這個分頁時，無法進行詳細擷取。',
      omittedFromExport: '這份經過清理的匯出內容已省略回應內文。',
      closeDevTools: '請關閉這個分頁的開發人員工具，然後再次要求這些詳細資料。',
      evicted: 'Chromium 有上限的診斷緩衝區中已不再保有這個回應內文。'
    },
    searchFields: {
      error: '要求錯誤',
      message: '{direction}的{kind}訊息',
      event: '{name} 事件'
    }
  },
  'id-ID': {
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
  },
  'vi-VN': {
    resourceTypes: {
      document: 'Tài liệu',
      stylesheet: 'Biểu định kiểu',
      image: 'Hình ảnh',
      media: 'Nội dung đa phương tiện',
      font: 'Phông chữ',
      script: 'Tập lệnh',
      texttrack: 'Kênh văn bản',
      xhr: 'XHR',
      fetch: 'Fetch',
      prefetch: 'Tìm nạp trước',
      eventsource: 'EventSource',
      websocket: 'WebSocket',
      manifest: 'Tệp kê khai',
      signedexchange: 'Trao đổi đã ký',
      ping: 'Ping',
      cspviolationreport: 'Báo cáo vi phạm CSP',
      preflight: 'Kiểm tra trước',
      fedcm: 'FedCM',
      other: 'Khác'
    },
    responseSources: {
      network: 'Mạng',
      serviceWorker: 'Service worker',
      prefetchCache: 'Bộ nhớ đệm tìm nạp trước',
      diskCache: 'Bộ nhớ đệm trên ổ đĩa',
      otherCache: 'Bộ nhớ đệm của trình duyệt'
    },
    workerSources: {
      cacheStorage: 'Cache Storage',
      httpCache: 'Bộ nhớ đệm HTTP',
      fallbackCode: 'Mã dự phòng của worker',
      network: 'Mạng qua worker'
    },
    initiatorTypes: {
      parser: 'Trình phân tích cú pháp',
      script: 'Tập lệnh',
      preload: 'Tải trước',
      signedexchange: 'Trao đổi đã ký',
      preflight: 'Kiểm tra trước',
      fedcm: 'FedCM',
      redirect: 'Chuyển hướng',
      other: 'Khác'
    },
    messageDirections: {
      sent: 'đã gửi',
      received: 'đã nhận',
      error: 'lỗi'
    },
    messageKinds: {
      text: 'văn bản',
      binary: 'nhị phân',
      continuation: 'tiếp nối',
      close: 'đóng',
      ping: 'ping',
      pong: 'pong',
      error: 'lỗi',
      unknown: 'không xác định'
    },
    bodyNotes: {
      binary: 'Đã bỏ qua nội dung nhị phân.',
      multipart: 'Đã bỏ qua nội dung nhiều phần.',
      unsafeJson: 'Đã bỏ qua nội dung JSON vì không thể ẩn thông tin nhạy cảm một cách an toàn.',
      nonText: 'Đã bỏ qua nội dung không phải văn bản.'
    },
    bodyReasons: {
      eventStream: 'Các sự kiện do máy chủ gửi có trong mục Luồng sự kiện có giới hạn.',
      webSocket: 'Các tin nhắn WebSocket có trong mục tin nhắn có giới hạn.',
      expired: 'Chromium không còn cung cấp nội dung phản hồi.',
      incomplete: 'Nội dung phản hồi chưa hoàn tất.',
      devToolsCapture: 'Không thể ghi lại chi tiết trong khi Công cụ cho nhà phát triển đang kiểm soát thẻ này.',
      omittedFromExport: 'Nội dung phản hồi đã bị bỏ qua trong bản xuất đã làm sạch này.',
      closeDevTools: 'Hãy đóng Công cụ cho nhà phát triển của thẻ này, rồi yêu cầu lại các chi tiết này.',
      evicted: 'Chromium không còn giữ nội dung phản hồi này trong bộ đệm chẩn đoán có giới hạn.'
    },
    searchFields: {
      error: 'Lỗi yêu cầu',
      message: 'Tin nhắn {kind} {direction}',
      event: 'Sự kiện {name}'
    }
  }
}

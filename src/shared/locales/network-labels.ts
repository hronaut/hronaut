// Names for the Chromium codes and Hronaut's English notes the Network panel
// shows. Filters, HAR files and MCP results keep the codes and the English text
// from src/shared.
export const networkLabelMessages = {
  "en-US": {
    "resourceTypes": {
      "document": "Document",
      "stylesheet": "Stylesheet",
      "image": "Image",
      "media": "Media",
      "font": "Font",
      "script": "Script",
      "texttrack": "Text track",
      "xhr": "XHR",
      "fetch": "Fetch",
      "prefetch": "Prefetch",
      "eventsource": "EventSource",
      "websocket": "WebSocket",
      "manifest": "Manifest",
      "signedexchange": "Signed exchange",
      "ping": "Ping",
      "cspviolationreport": "CSP violation report",
      "preflight": "Preflight",
      "fedcm": "FedCM",
      "other": "Other"
    },
    "responseSources": {
      "network": "Network",
      "serviceWorker": "Service worker",
      "prefetchCache": "Prefetch cache",
      "diskCache": "Disk cache",
      "otherCache": "Browser cache"
    },
    "workerSources": {
      "cacheStorage": "Cache Storage",
      "httpCache": "HTTP cache",
      "fallbackCode": "Worker fallback code",
      "network": "Network through worker"
    },
    "initiatorTypes": {
      "parser": "Parser",
      "script": "Script",
      "preload": "Preload",
      "signedexchange": "Signed exchange",
      "preflight": "Preflight",
      "fedcm": "FedCM",
      "redirect": "Redirect",
      "other": "Other"
    },
    "messageDirections": {
      "sent": "sent",
      "received": "received",
      "error": "error"
    },
    "messageKinds": {
      "text": "text",
      "binary": "binary",
      "continuation": "continuation",
      "close": "close",
      "ping": "ping",
      "pong": "pong",
      "error": "error",
      "unknown": "unknown"
    },
    "bodyNotes": {
      "binary": "Binary body omitted.",
      "multipart": "Multipart body omitted.",
      "unsafeJson": "JSON body omitted because it could not be safely redacted.",
      "nonText": "Non-text body omitted."
    },
    "bodyReasons": {
      "eventStream": "Server-sent events are available in the bounded Event stream section.",
      "webSocket": "WebSocket messages are available in the bounded messages section.",
      "expired": "Response body is no longer available from Chromium.",
      "incomplete": "The response body has not completed.",
      "devToolsCapture": "Detailed capture was unavailable while Developer Tools owned this tab.",
      "omittedFromExport": "Response body was omitted from this sanitized export.",
      "closeDevTools": "Close Developer Tools for this tab, then request these details again.",
      "evicted": "Chromium no longer has this response body in its bounded diagnostic buffer."
    },
    "searchFields": {
      "error": "Request error",
      "message": "{direction} {kind} message",
      "event": "{name} event"
    }
  },
  "de-DE": {
    "resourceTypes": {
      "document": "Dokument",
      "stylesheet": "Stylesheet",
      "image": "Bild",
      "media": "Medien",
      "font": "Schriftart",
      "script": "Skript",
      "texttrack": "Textspur",
      "xhr": "XHR",
      "fetch": "Fetch",
      "prefetch": "Vorabruf",
      "eventsource": "EventSource",
      "websocket": "WebSocket",
      "manifest": "Manifest",
      "signedexchange": "Signed Exchange",
      "ping": "Ping",
      "cspviolationreport": "CSP-Verstoßbericht",
      "preflight": "Preflight",
      "fedcm": "FedCM",
      "other": "Andere"
    },
    "responseSources": {
      "network": "Netzwerk",
      "serviceWorker": "Service Worker",
      "prefetchCache": "Vorabruf-Cache",
      "diskCache": "Festplatten-Cache",
      "otherCache": "Browser-Cache"
    },
    "workerSources": {
      "cacheStorage": "Cache Storage",
      "httpCache": "HTTP-Cache",
      "fallbackCode": "Ersatzcode des Workers",
      "network": "Netzwerk über den Worker"
    },
    "initiatorTypes": {
      "parser": "Parser",
      "script": "Skript",
      "preload": "Preload",
      "signedexchange": "Signed Exchange",
      "preflight": "Preflight",
      "fedcm": "FedCM",
      "redirect": "Umleitung",
      "other": "Andere"
    },
    "messageDirections": {
      "sent": "gesendet",
      "received": "empfangen",
      "error": "Fehler"
    },
    "messageKinds": {
      "text": "Text",
      "binary": "binär",
      "continuation": "Fortsetzung",
      "close": "Schließen",
      "ping": "Ping",
      "pong": "Pong",
      "error": "Fehler",
      "unknown": "unbekannt"
    },
    "bodyNotes": {
      "binary": "Binärer Inhalt ausgelassen.",
      "multipart": "Multipart-Inhalt ausgelassen.",
      "unsafeJson": "JSON-Inhalt ausgelassen, weil er sich nicht sicher bereinigen ließ.",
      "nonText": "Nicht-Text-Inhalt ausgelassen."
    },
    "bodyReasons": {
      "eventStream": "Server-Sent Events stehen im begrenzten Abschnitt „Ereignisstrom“.",
      "webSocket": "WebSocket-Nachrichten stehen im begrenzten Abschnitt „Nachrichten“.",
      "expired": "Chromium stellt den Antworttext nicht mehr bereit.",
      "incomplete": "Der Antworttext ist noch nicht vollständig.",
      "devToolsCapture": "Die detaillierte Erfassung war nicht verfügbar, während die Entwicklertools diesen Tab belegten.",
      "omittedFromExport": "Der Antworttext wurde in diesem bereinigten Export ausgelassen.",
      "closeDevTools": "Schließe die Entwicklertools für diesen Tab und fordere diese Details dann erneut an.",
      "evicted": "Chromium hat diesen Antworttext nicht mehr in seinem begrenzten Diagnosepuffer."
    },
    "searchFields": {
      "error": "Anfragefehler",
      "message": "Nachricht ({direction}, {kind})",
      "event": "Ereignis {name}"
    }
  },
  "es-ES": {
    "resourceTypes": {
      "document": "Documento",
      "stylesheet": "Hoja de estilos",
      "image": "Imagen",
      "media": "Multimedia",
      "font": "Fuente",
      "script": "Script",
      "texttrack": "Pista de texto",
      "xhr": "XHR",
      "fetch": "Fetch",
      "prefetch": "Prefetch",
      "eventsource": "EventSource",
      "websocket": "WebSocket",
      "manifest": "Manifiesto",
      "signedexchange": "Intercambio firmado",
      "ping": "Ping",
      "cspviolationreport": "Informe de infracción de CSP",
      "preflight": "Preflight",
      "fedcm": "FedCM",
      "other": "Otro"
    },
    "responseSources": {
      "network": "Red",
      "serviceWorker": "Service worker",
      "prefetchCache": "Caché de prefetch",
      "diskCache": "Caché de disco",
      "otherCache": "Caché del navegador"
    },
    "workerSources": {
      "cacheStorage": "Cache Storage",
      "httpCache": "Caché HTTP",
      "fallbackCode": "Código alternativo del worker",
      "network": "Red a través del worker"
    },
    "initiatorTypes": {
      "parser": "Analizador",
      "script": "Script",
      "preload": "Precarga",
      "signedexchange": "Intercambio firmado",
      "preflight": "Preflight",
      "fedcm": "FedCM",
      "redirect": "Redirección",
      "other": "Otro"
    },
    "messageDirections": {
      "sent": "enviado",
      "received": "recibido",
      "error": "error"
    },
    "messageKinds": {
      "text": "texto",
      "binary": "binario",
      "continuation": "continuación",
      "close": "cierre",
      "ping": "ping",
      "pong": "pong",
      "error": "error",
      "unknown": "desconocido"
    },
    "bodyNotes": {
      "binary": "Cuerpo binario omitido.",
      "multipart": "Cuerpo multipart omitido.",
      "unsafeJson": "Cuerpo JSON omitido porque no se pudo depurar de forma segura.",
      "nonText": "Cuerpo no textual omitido."
    },
    "bodyReasons": {
      "eventStream": "Los eventos enviados por el servidor están en la sección limitada «Flujo de eventos».",
      "webSocket": "Los mensajes de WebSocket están en la sección limitada «Mensajes».",
      "expired": "Chromium ya no ofrece el cuerpo de la respuesta.",
      "incomplete": "El cuerpo de la respuesta aún no se ha completado.",
      "devToolsCapture": "La captura detallada no estaba disponible mientras las herramientas de desarrollo controlaban esta pestaña.",
      "omittedFromExport": "El cuerpo de la respuesta se omitió de esta exportación depurada.",
      "closeDevTools": "Cierra las herramientas de desarrollo de esta pestaña y vuelve a solicitar estos detalles.",
      "evicted": "Chromium ya no conserva este cuerpo de respuesta en su búfer de diagnóstico limitado."
    },
    "searchFields": {
      "error": "Error de la solicitud",
      "message": "Mensaje ({direction}, {kind})",
      "event": "Evento {name}"
    }
  },
  "fr-FR": {
    "resourceTypes": {
      "document": "Document",
      "stylesheet": "Feuille de style",
      "image": "Image",
      "media": "Média",
      "font": "Police",
      "script": "Script",
      "texttrack": "Piste de texte",
      "xhr": "XHR",
      "fetch": "Fetch",
      "prefetch": "Prélecture",
      "eventsource": "EventSource",
      "websocket": "WebSocket",
      "manifest": "Manifeste",
      "signedexchange": "Échange signé",
      "ping": "Ping",
      "cspviolationreport": "Rapport de violation CSP",
      "preflight": "Preflight",
      "fedcm": "FedCM",
      "other": "Autre"
    },
    "responseSources": {
      "network": "Réseau",
      "serviceWorker": "Service worker",
      "prefetchCache": "Cache de prélecture",
      "diskCache": "Cache disque",
      "otherCache": "Cache du navigateur"
    },
    "workerSources": {
      "cacheStorage": "Cache Storage",
      "httpCache": "Cache HTTP",
      "fallbackCode": "Code de secours du worker",
      "network": "Réseau via le worker"
    },
    "initiatorTypes": {
      "parser": "Analyseur",
      "script": "Script",
      "preload": "Préchargement",
      "signedexchange": "Échange signé",
      "preflight": "Preflight",
      "fedcm": "FedCM",
      "redirect": "Redirection",
      "other": "Autre"
    },
    "messageDirections": {
      "sent": "envoyé",
      "received": "reçu",
      "error": "erreur"
    },
    "messageKinds": {
      "text": "texte",
      "binary": "binaire",
      "continuation": "continuation",
      "close": "fermeture",
      "ping": "ping",
      "pong": "pong",
      "error": "erreur",
      "unknown": "inconnu"
    },
    "bodyNotes": {
      "binary": "Corps binaire omis.",
      "multipart": "Corps multipart omis.",
      "unsafeJson": "Corps JSON omis, car il n’a pas pu être nettoyé en toute sécurité.",
      "nonText": "Corps non textuel omis."
    },
    "bodyReasons": {
      "eventStream": "Les événements envoyés par le serveur figurent dans la section limitée « Flux d’événements ».",
      "webSocket": "Les messages WebSocket figurent dans la section limitée « Messages ».",
      "expired": "Chromium ne fournit plus le corps de la réponse.",
      "incomplete": "Le corps de la réponse n’est pas encore complet.",
      "devToolsCapture": "La capture détaillée était indisponible pendant que les outils de développement contrôlaient cet onglet.",
      "omittedFromExport": "Le corps de la réponse a été omis de cet export nettoyé.",
      "closeDevTools": "Fermez les outils de développement de cet onglet, puis demandez de nouveau ces détails.",
      "evicted": "Chromium ne conserve plus ce corps de réponse dans son tampon de diagnostic limité."
    },
    "searchFields": {
      "error": "Erreur de la requête",
      "message": "Message ({direction}, {kind})",
      "event": "Événement {name}"
    }
  },
  "pl-PL": {
    "resourceTypes": {
      "document": "Dokument",
      "stylesheet": "Arkusz stylów",
      "image": "Obraz",
      "media": "Multimedia",
      "font": "Czcionka",
      "script": "Skrypt",
      "texttrack": "Ścieżka tekstowa",
      "xhr": "XHR",
      "fetch": "Fetch",
      "prefetch": "Prefetch",
      "eventsource": "EventSource",
      "websocket": "WebSocket",
      "manifest": "Manifest",
      "signedexchange": "Podpisana wymiana",
      "ping": "Ping",
      "cspviolationreport": "Raport naruszenia CSP",
      "preflight": "Preflight",
      "fedcm": "FedCM",
      "other": "Inne"
    },
    "responseSources": {
      "network": "Sieć",
      "serviceWorker": "Service worker",
      "prefetchCache": "Pamięć podręczna prefetch",
      "diskCache": "Pamięć podręczna dysku",
      "otherCache": "Pamięć podręczna przeglądarki"
    },
    "workerSources": {
      "cacheStorage": "Cache Storage",
      "httpCache": "Pamięć podręczna HTTP",
      "fallbackCode": "Kod zastępczy workera",
      "network": "Sieć przez workera"
    },
    "initiatorTypes": {
      "parser": "Parser",
      "script": "Skrypt",
      "preload": "Preload",
      "signedexchange": "Podpisana wymiana",
      "preflight": "Preflight",
      "fedcm": "FedCM",
      "redirect": "Przekierowanie",
      "other": "Inne"
    },
    "messageDirections": {
      "sent": "wysłano",
      "received": "odebrano",
      "error": "błąd"
    },
    "messageKinds": {
      "text": "tekst",
      "binary": "binarny",
      "continuation": "kontynuacja",
      "close": "zamknięcie",
      "ping": "ping",
      "pong": "pong",
      "error": "błąd",
      "unknown": "nieznany"
    },
    "bodyNotes": {
      "binary": "Pominięto treść binarną.",
      "multipart": "Pominięto treść multipart.",
      "unsafeJson": "Pominięto treść JSON, bo nie dało się jej bezpiecznie oczyścić.",
      "nonText": "Pominięto treść, która nie jest tekstem."
    },
    "bodyReasons": {
      "eventStream": "Zdarzenia wysyłane przez serwer są w ograniczonej sekcji „Strumień zdarzeń”.",
      "webSocket": "Wiadomości WebSocket są w ograniczonej sekcji „Wiadomości”.",
      "expired": "Chromium nie udostępnia już treści odpowiedzi.",
      "incomplete": "Treść odpowiedzi nie jest jeszcze kompletna.",
      "devToolsCapture": "Szczegółowe przechwytywanie było niedostępne, gdy narzędzia deweloperskie zajmowały tę kartę.",
      "omittedFromExport": "Treść odpowiedzi pominięto w tym oczyszczonym eksporcie.",
      "closeDevTools": "Zamknij narzędzia deweloperskie tej karty, a potem ponownie poproś o te szczegóły.",
      "evicted": "Chromium nie ma już tej treści odpowiedzi w swoim ograniczonym buforze diagnostycznym."
    },
    "searchFields": {
      "error": "Błąd żądania",
      "message": "Wiadomość ({direction}, {kind})",
      "event": "Zdarzenie {name}"
    }
  },
  "uk-UA": {
    "resourceTypes": {
      "document": "Документ",
      "stylesheet": "Таблиця стилів",
      "image": "Зображення",
      "media": "Медіа",
      "font": "Шрифт",
      "script": "Скрипт",
      "texttrack": "Текстова доріжка",
      "xhr": "XHR",
      "fetch": "Fetch",
      "prefetch": "Попереднє завантаження",
      "eventsource": "EventSource",
      "websocket": "WebSocket",
      "manifest": "Маніфест",
      "signedexchange": "Підписаний обмін",
      "ping": "Ping",
      "cspviolationreport": "Звіт про порушення CSP",
      "preflight": "Preflight",
      "fedcm": "FedCM",
      "other": "Інше"
    },
    "responseSources": {
      "network": "Мережа",
      "serviceWorker": "Service worker",
      "prefetchCache": "Кеш попереднього завантаження",
      "diskCache": "Дисковий кеш",
      "otherCache": "Кеш браузера"
    },
    "workerSources": {
      "cacheStorage": "Cache Storage",
      "httpCache": "HTTP-кеш",
      "fallbackCode": "Резервний код воркера",
      "network": "Мережа через воркер"
    },
    "initiatorTypes": {
      "parser": "Парсер",
      "script": "Скрипт",
      "preload": "Preload",
      "signedexchange": "Підписаний обмін",
      "preflight": "Preflight",
      "fedcm": "FedCM",
      "redirect": "Переспрямування",
      "other": "Інше"
    },
    "messageDirections": {
      "sent": "надіслано",
      "received": "отримано",
      "error": "помилка"
    },
    "messageKinds": {
      "text": "текст",
      "binary": "бінарний",
      "continuation": "продовження",
      "close": "закриття",
      "ping": "ping",
      "pong": "pong",
      "error": "помилка",
      "unknown": "невідомий"
    },
    "bodyNotes": {
      "binary": "Бінарне тіло виключено.",
      "multipart": "Тіло multipart виключено.",
      "unsafeJson": "Тіло JSON виключено, бо його не вдалося безпечно очистити.",
      "nonText": "Нетекстове тіло виключено."
    },
    "bodyReasons": {
      "eventStream": "Події, надіслані сервером, доступні в обмеженому розділі «Потік подій».",
      "webSocket": "Повідомлення WebSocket доступні в обмеженому розділі «Повідомлення».",
      "expired": "Chromium більше не надає тіло відповіді.",
      "incomplete": "Тіло відповіді ще не отримано повністю.",
      "devToolsCapture": "Докладне захоплення було недоступне, поки інструменти розробника займали цю вкладку.",
      "omittedFromExport": "Тіло відповіді виключено з цього очищеного експорту.",
      "closeDevTools": "Закрийте інструменти розробника для цієї вкладки, а потім знову запросіть ці відомості.",
      "evicted": "Chromium більше не зберігає це тіло відповіді у своєму обмеженому діагностичному буфері."
    },
    "searchFields": {
      "error": "Помилка запиту",
      "message": "Повідомлення ({direction}, {kind})",
      "event": "Подія {name}"
    }
  },
  "ru-RU": {
    "resourceTypes": {
      "document": "Документ",
      "stylesheet": "Таблица стилей",
      "image": "Изображение",
      "media": "Медиа",
      "font": "Шрифт",
      "script": "Скрипт",
      "texttrack": "Текстовая дорожка",
      "xhr": "XHR",
      "fetch": "Fetch",
      "prefetch": "Предварительная загрузка",
      "eventsource": "EventSource",
      "websocket": "WebSocket",
      "manifest": "Манифест",
      "signedexchange": "Подписанный обмен",
      "ping": "Ping",
      "cspviolationreport": "Отчёт о нарушении CSP",
      "preflight": "Preflight",
      "fedcm": "FedCM",
      "other": "Другое"
    },
    "responseSources": {
      "network": "Сеть",
      "serviceWorker": "Service worker",
      "prefetchCache": "Кеш предварительной загрузки",
      "diskCache": "Дисковый кеш",
      "otherCache": "Кеш браузера"
    },
    "workerSources": {
      "cacheStorage": "Cache Storage",
      "httpCache": "HTTP-кеш",
      "fallbackCode": "Резервный код worker",
      "network": "Сеть через worker"
    },
    "initiatorTypes": {
      "parser": "Парсер",
      "script": "Скрипт",
      "preload": "Preload",
      "signedexchange": "Подписанный обмен",
      "preflight": "Preflight",
      "fedcm": "FedCM",
      "redirect": "Перенаправление",
      "other": "Другое"
    },
    "messageDirections": {
      "sent": "отправлено",
      "received": "получено",
      "error": "ошибка"
    },
    "messageKinds": {
      "text": "текст",
      "binary": "двоичный",
      "continuation": "продолжение",
      "close": "закрытие",
      "ping": "ping",
      "pong": "pong",
      "error": "ошибка",
      "unknown": "неизвестный"
    },
    "bodyNotes": {
      "binary": "Двоичное тело исключено.",
      "multipart": "Тело multipart исключено.",
      "unsafeJson": "Тело JSON исключено, так как его не удалось безопасно очистить.",
      "nonText": "Нетекстовое тело исключено."
    },
    "bodyReasons": {
      "eventStream": "События, отправленные сервером, находятся в ограниченном разделе «Поток событий».",
      "webSocket": "Сообщения WebSocket находятся в ограниченном разделе «Сообщения».",
      "expired": "Chromium больше не предоставляет тело ответа.",
      "incomplete": "Тело ответа ещё не получено полностью.",
      "devToolsCapture": "Подробный захват был недоступен, пока инструменты разработчика занимали эту вкладку.",
      "omittedFromExport": "Тело ответа исключено из этого очищенного экспорта.",
      "closeDevTools": "Закройте инструменты разработчика для этой вкладки, а затем снова запросите эти сведения.",
      "evicted": "Chromium больше не хранит это тело ответа в своём ограниченном диагностическом буфере."
    },
    "searchFields": {
      "error": "Ошибка запроса",
      "message": "Сообщение ({direction}, {kind})",
      "event": "Событие {name}"
    }
  }
}

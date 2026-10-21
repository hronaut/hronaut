// Report caveats for Page performance, the Accessibility audit comparison and the IndexedDB inspector, keyed as
// PERFORMANCE_REPORT_CAVEATS, PERFORMANCE_COMPARISON_CAVEATS (src/shared/performance-audit.ts),
// ACCESSIBILITY_COMPARISON_CAVEATS (src/shared/accessibility-comparison.ts) and INDEXEDDB_CAVEATS (src/shared/indexeddb.ts).
// IndexedDB reports address agents; here the same points are worded for the person reading the panel.
export const reportCaveatMessages = {
  "en-US": {
    performance: {
      lcpPhases: "LCP phases are browser-timing observations, not causal proof. Missing or restricted evidence is explicit; restoration and soft-navigation phase attribution are unsupported.",
      localSample: "This is one local current-visit sample, not field data or a 75th-percentile CrUX result.",
      inpUnavailable: "INP is unavailable until the page receives a qualifying interaction; some metrics are unavailable for background or short-lived visits.",
      longAnimationFrames: "Long animation frame attribution identifies script entry points rather than necessarily the slowest internal function.",
      crossOrigin: "Cross-origin frames, workers, service workers, and isolated-world code may contribute work without script attribution.",
      userTimings: "User Timing names are page-authored and sanitized; arbitrary detail objects, stack traces, and source code are omitted.",
      layoutShifts: "Layout-shift evidence excludes entries with recent discrete input. Its score sum is diagnostic and may differ from CLS session-window scoring.",
      baselineUrl: "The baseline URL differs from this measurement; compare only if the navigation change was intentional.",
      environment: "The browser environment differs from the baseline; viewport, throttling, cache, headers, or locale changes can affect the delta.",
      deltas: "Before-and-after deltas compare two local samples and may include normal run-to-run variation; repeat important measurements under matching conditions."
    },
    accessibilityComparison: {
      urlChanged: "The page URL changed after the accessibility baseline.",
      scopeChanged: "The accessibility standard, selector, or collection limits changed; set a new baseline for this scope.",
      engineChanged: "The accessibility engine changed; set a new baseline before comparing findings.",
      baselineTruncated: "The baseline was truncated, so new findings cannot be determined safely.",
      currentTruncated: "The current audit was truncated, so resolved findings cannot be determined safely."
    },
    indexedDb: {
      origin: "Only this top-level origin is covered; databases in third-party frames are not included.",
      snapshot: "Databases and records are a point-in-time snapshot. Refresh after the website changes IndexedDB.",
      names: "Database, object store, index and key names are written by the website and can themselves contain private data.",
      longNames: "Databases and object stores with names longer than 512 characters are left out.",
      valuesIncluded: "Record previews are bounded and may contain private application data.",
      valuesOmitted: "Record values are left out.",
      readOnly: "This inspector only reads IndexedDB and never changes or clears it."
    }
  },
  "de-DE": {
    performance: {
      lcpPhases: "LCP-Phasen sind Zeitbeobachtungen des Browsers, kein Ursachennachweis. Fehlende oder eingeschränkte Daten werden ausdrücklich ausgewiesen; Phasen nach einer Wiederherstellung oder Soft Navigation werden nicht zugeordnet.",
      localSample: "Dies ist eine einzelne lokale Stichprobe des aktuellen Besuchs, keine Felddaten und kein CrUX-Ergebnis zum 75. Perzentil.",
      inpUnavailable: "INP ist erst verfügbar, wenn die Seite eine geeignete Interaktion erhält; bei Besuchen im Hintergrund oder sehr kurzen Besuchen fehlen manche Messwerte.",
      longAnimationFrames: "Die Zuordnung langer Animationsframes nennt die Einstiegspunkte von Skripten, nicht unbedingt die langsamste interne Funktion.",
      crossOrigin: "Frames anderer Ursprünge, Worker, Service Worker und Code in isolierten Welten können Arbeit verursachen, die keinem Skript zugeordnet wird.",
      userTimings: "Namen benutzerdefinierter Zeitmessungen stammen von der Seite und werden bereinigt; beliebige Detailobjekte, Stacktraces und Quellcode werden weggelassen.",
      layoutShifts: "Layoutverschiebungen kurz nach einer Eingabe werden nicht berücksichtigt. Die Summe ihrer Werte dient der Diagnose und kann von der CLS-Bewertung nach Sitzungsfenstern abweichen.",
      baselineUrl: "Die Adresse des Ausgangswerts unterscheidet sich von dieser Messung; vergleichen Sie nur, wenn die Navigation beabsichtigt war.",
      environment: "Die Browserumgebung unterscheidet sich vom Ausgangswert; Änderungen an Ansichtsbereich, Drosselung, Cache, Headern oder Sprache können die Differenz beeinflussen.",
      deltas: "Vorher-nachher-Differenzen vergleichen zwei lokale Stichproben und können normale Schwankungen zwischen Läufen enthalten; wiederholen Sie wichtige Messungen unter gleichen Bedingungen."
    },
    accessibilityComparison: {
      urlChanged: "Die Seitenadresse hat sich seit der Baseline geändert.",
      scopeChanged: "Standard, Selektor oder Erfassungsgrenzen der Prüfung haben sich geändert; legen Sie für diesen Umfang eine neue Baseline fest.",
      engineChanged: "Die Prüf-Engine hat sich geändert; legen Sie vor dem Vergleich eine neue Baseline fest.",
      baselineTruncated: "Die Baseline wurde gekürzt, daher lassen sich neue Befunde nicht sicher bestimmen.",
      currentTruncated: "Die aktuelle Prüfung wurde gekürzt, daher lassen sich behobene Befunde nicht sicher bestimmen."
    },
    indexedDb: {
      origin: "Nur dieser Top-Level-Ursprung wird erfasst; Datenbanken in Frames von Drittanbietern sind nicht enthalten.",
      snapshot: "Datenbanken und Datensätze sind eine Momentaufnahme. Aktualisieren Sie, nachdem die Website IndexedDB geändert hat.",
      names: "Namen von Datenbanken, Objektspeichern, Indizes und Schlüsseln stammen von der Website und können selbst private Daten enthalten.",
      longNames: "Datenbanken und Objektspeicher mit Namen über 512 Zeichen werden ausgelassen.",
      valuesIncluded: "Vorschauen der Datensätze sind begrenzt und können private Anwendungsdaten enthalten.",
      valuesOmitted: "Werte der Datensätze werden ausgelassen.",
      readOnly: "Diese Ansicht liest IndexedDB nur und ändert oder löscht nichts."
    }
  },
  "fr-FR": {
    performance: {
      lcpPhases: "Les phases du LCP sont des mesures de temps du navigateur, pas une preuve de cause. Les données manquantes ou restreintes sont signalées ; l’attribution des phases après une restauration ou une navigation douce n’est pas prise en charge.",
      localSample: "Il s’agit d’un seul échantillon local de la visite en cours, et non de données terrain ni d’un résultat CrUX au 75e centile.",
      inpUnavailable: "L’INP reste indisponible tant que la page n’a pas reçu d’interaction prise en compte ; certaines métriques sont indisponibles pour les visites en arrière-plan ou très courtes.",
      longAnimationFrames: "L’attribution des longues images d’animation désigne les points d’entrée des scripts, pas forcément la fonction interne la plus lente.",
      crossOrigin: "Les cadres d’autres origines, les workers, les service workers et le code des mondes isolés peuvent effectuer du travail sans être attribués à un script.",
      userTimings: "Les noms de chronométrage utilisateur sont définis par la page et nettoyés ; les objets de détail arbitraires, les piles d’appels et le code source sont omis.",
      layoutShifts: "Les décalages de mise en page survenus juste après une saisie sont exclus. La somme de leurs scores sert au diagnostic et peut différer du CLS calculé par fenêtres de session.",
      baselineUrl: "L’adresse de la référence diffère de cette mesure ; ne comparez que si le changement de navigation était voulu.",
      environment: "L’environnement du navigateur diffère de la référence ; un changement de zone d’affichage, de ralentissement, de cache, d’en-têtes ou de langue peut influer sur l’écart.",
      deltas: "Les écarts avant et après comparent deux échantillons locaux et peuvent inclure la variation normale d’une exécution à l’autre ; répétez les mesures importantes dans les mêmes conditions."
    },
    accessibilityComparison: {
      urlChanged: "L’adresse de la page a changé depuis la référence d’accessibilité.",
      scopeChanged: "La norme, le sélecteur ou les limites de collecte de l’audit ont changé ; définissez une nouvelle référence pour cette portée.",
      engineChanged: "Le moteur d’audit a changé ; définissez une nouvelle référence avant de comparer les constats.",
      baselineTruncated: "La référence a été tronquée : les nouveaux constats ne peuvent pas être déterminés de façon fiable.",
      currentTruncated: "L’audit actuel a été tronqué : les constats résolus ne peuvent pas être déterminés de façon fiable."
    },
    indexedDb: {
      origin: "Seule cette origine de premier niveau est couverte ; les bases de données des cadres tiers ne sont pas incluses.",
      snapshot: "Les bases de données et les enregistrements sont un instantané. Actualisez après une modification d’IndexedDB par le site.",
      names: "Les noms des bases de données, magasins d’objets, index et clés sont définis par le site et peuvent eux-mêmes contenir des données privées.",
      longNames: "Les bases de données et magasins d’objets dont le nom dépasse 512 caractères sont omis.",
      valuesIncluded: "Les aperçus des enregistrements sont limités et peuvent contenir des données privées de l’application.",
      valuesOmitted: "Les valeurs des enregistrements sont omises.",
      readOnly: "Cet inspecteur lit seulement IndexedDB, sans jamais le modifier ni l’effacer."
    }
  },
  "es-ES": {
    performance: {
      lcpPhases: "Las fases del LCP son mediciones de tiempo del navegador, no una prueba de causa. Los datos que faltan o están restringidos se indican; no se atribuyen fases tras una restauración ni en navegaciones suaves.",
      localSample: "Es una sola muestra local de la visita actual, no datos de campo ni un resultado de CrUX en el percentil 75.",
      inpUnavailable: "El INP no está disponible hasta que la página recibe una interacción válida; algunas métricas no están disponibles en visitas en segundo plano o muy breves.",
      longAnimationFrames: "La atribución de fotogramas de animación largos señala los puntos de entrada de los scripts, no necesariamente la función interna más lenta.",
      crossOrigin: "Los marcos de otros orígenes, los workers, los service workers y el código de mundos aislados pueden generar trabajo sin atribución a un script.",
      userTimings: "Los nombres de los tiempos de usuario los define la página y se depuran; se omiten los objetos de detalle arbitrarios, las pilas de llamadas y el código fuente.",
      layoutShifts: "Se excluyen los desplazamientos de diseño ocurridos justo después de una entrada. La suma de sus puntuaciones es orientativa y puede diferir del CLS calculado por ventanas de sesión.",
      baselineUrl: "La dirección de la referencia difiere de esta medición; compara solo si el cambio de navegación fue intencionado.",
      environment: "El entorno del navegador difiere de la referencia; los cambios de área visible, ralentización, caché, encabezados o idioma pueden afectar a la diferencia.",
      deltas: "Las diferencias de antes y después comparan dos muestras locales y pueden incluir la variación normal entre ejecuciones; repite las mediciones importantes en las mismas condiciones."
    },
    accessibilityComparison: {
      urlChanged: "La dirección de la página cambió desde la referencia de accesibilidad.",
      scopeChanged: "Cambiaron el estándar, el selector o los límites de recopilación de la auditoría; establece una nueva referencia para este alcance.",
      engineChanged: "Cambió el motor de auditoría; establece una nueva referencia antes de comparar hallazgos.",
      baselineTruncated: "La referencia se truncó, así que los hallazgos nuevos no se pueden determinar con seguridad.",
      currentTruncated: "La auditoría actual se truncó, así que los hallazgos resueltos no se pueden determinar con seguridad."
    },
    indexedDb: {
      origin: "Solo se incluye este origen de nivel superior; no se incluyen las bases de datos de marcos de terceros.",
      snapshot: "Las bases de datos y los registros son una instantánea. Actualiza después de que el sitio cambie IndexedDB.",
      names: "Los nombres de bases de datos, almacenes de objetos, índices y claves los define el sitio y pueden contener datos privados.",
      longNames: "Se omiten las bases de datos y los almacenes de objetos con nombres de más de 512 caracteres.",
      valuesIncluded: "Las vistas previas de los registros son limitadas y pueden contener datos privados de la aplicación.",
      valuesOmitted: "Se omiten los valores de los registros.",
      readOnly: "Este inspector solo lee IndexedDB y nunca lo modifica ni lo borra."
    }
  },
  "pl-PL": {
    performance: {
      lcpPhases: "Fazy LCP to pomiary czasu przeglądarki, a nie dowód przyczyny. Brakujące lub ograniczone dane są wyraźnie oznaczone; fazy po przywróceniu strony i w miękkiej nawigacji nie są przypisywane.",
      localSample: "To pojedyncza lokalna próbka bieżącej wizyty, a nie dane terenowe ani wynik CrUX dla 75. percentyla.",
      inpUnavailable: "INP jest niedostępny, dopóki strona nie otrzyma kwalifikującej się interakcji; niektóre metryki są niedostępne dla wizyt w tle lub bardzo krótkich.",
      longAnimationFrames: "Przypisanie długich klatek animacji wskazuje punkty wejścia skryptów, niekoniecznie najwolniejszą funkcję wewnętrzną.",
      crossOrigin: "Ramki z innych źródeł, workery, service workery i kod w izolowanych światach mogą wykonywać pracę bez przypisania do skryptu.",
      userTimings: "Nazwy czasów użytkownika pochodzą ze strony i są oczyszczane; dowolne obiekty szczegółów, stosy wywołań i kod źródłowy są pomijane.",
      layoutShifts: "Przesunięcia układu tuż po wprowadzeniu danych są pomijane. Suma ich wyników służy diagnozie i może różnić się od CLS liczonego w oknach sesji.",
      baselineUrl: "Adres stanu bazowego różni się od tego pomiaru; porównuj tylko wtedy, gdy zmiana nawigacji była zamierzona.",
      environment: "Środowisko przeglądarki różni się od stanu bazowego; zmiany obszaru wyświetlania, ograniczania, pamięci podręcznej, nagłówków lub języka mogą wpłynąć na różnicę.",
      deltas: "Różnice przed i po porównują dwie lokalne próbki i mogą obejmować zwykłe wahania między przebiegami; powtarzaj ważne pomiary w tych samych warunkach."
    },
    accessibilityComparison: {
      urlChanged: "Adres strony zmienił się od ustawienia punktu odniesienia dostępności.",
      scopeChanged: "Zmienił się standard, selektor lub limity zbierania audytu; ustaw nowy punkt odniesienia dla tego zakresu.",
      engineChanged: "Zmienił się silnik audytu; ustaw nowy punkt odniesienia przed porównaniem problemów.",
      baselineTruncated: "Punkt odniesienia został obcięty, więc nie da się bezpiecznie ustalić nowych problemów.",
      currentTruncated: "Bieżący audyt został obcięty, więc nie da się bezpiecznie ustalić rozwiązanych problemów."
    },
    indexedDb: {
      origin: "Uwzględniane jest tylko to źródło najwyższego poziomu; bazy danych ramek innych firm są pomijane.",
      snapshot: "Bazy danych i rekordy to migawka z danej chwili. Odśwież po zmianie IndexedDB przez witrynę.",
      names: "Nazwy baz danych, magazynów obiektów, indeksów i kluczy pochodzą z witryny i same mogą zawierać prywatne dane.",
      longNames: "Bazy danych i magazyny obiektów o nazwach dłuższych niż 512 znaków są pomijane.",
      valuesIncluded: "Podglądy rekordów są ograniczone i mogą zawierać prywatne dane aplikacji.",
      valuesOmitted: "Wartości rekordów są pomijane.",
      readOnly: "Ten inspektor tylko odczytuje IndexedDB i nigdy go nie zmienia ani nie czyści."
    }
  },
  "ru-RU": {
    performance: {
      lcpPhases: "Фазы LCP — это измерения времени браузером, а не доказательство причины. Отсутствующие или ограниченные данные отмечаются явно; фазы после восстановления страницы и при мягкой навигации не определяются.",
      localSample: "Это одна локальная выборка текущего посещения, а не полевые данные и не результат CrUX по 75-му процентилю.",
      inpUnavailable: "INP недоступен, пока страница не получит подходящее взаимодействие; некоторые метрики недоступны для фоновых или очень коротких посещений.",
      longAnimationFrames: "Атрибуция долгих кадров анимации указывает точки входа скриптов, а не обязательно самую медленную внутреннюю функцию.",
      crossOrigin: "Фреймы других источников, воркеры, service worker и код изолированных миров могут выполнять работу без привязки к скрипту.",
      userTimings: "Названия пользовательских меток времени задаёт страница, и они очищаются; произвольные объекты деталей, стеки вызовов и исходный код опускаются.",
      layoutShifts: "Сдвиги макета сразу после ввода не учитываются. Сумма их оценок служит для диагностики и может отличаться от CLS, рассчитанного по окнам сеанса.",
      baselineUrl: "Адрес базового уровня отличается от этого измерения; сравнивайте, только если переход был намеренным.",
      environment: "Среда браузера отличается от базового уровня; изменения области просмотра, замедления, кеша, заголовков или языка могут повлиять на разницу.",
      deltas: "Разница «до и после» сравнивает две локальные выборки и может включать обычный разброс между запусками; повторяйте важные измерения в одинаковых условиях."
    },
    accessibilityComparison: {
      urlChanged: "Адрес страницы изменился после базового аудита доступности.",
      scopeChanged: "Изменились стандарт, селектор или ограничения сбора аудита; задайте новый базовый уровень для этой области.",
      engineChanged: "Изменился движок аудита; задайте новый базовый уровень перед сравнением проблем.",
      baselineTruncated: "Базовый аудит был сокращён, поэтому новые проблемы нельзя определить надёжно.",
      currentTruncated: "Текущий аудит был сокращён, поэтому решённые проблемы нельзя определить надёжно."
    },
    indexedDb: {
      origin: "Учитывается только этот источник верхнего уровня; базы данных сторонних фреймов не включаются.",
      snapshot: "Базы данных и записи — это снимок на определённый момент. Обновите после того, как сайт изменит IndexedDB.",
      names: "Имена баз данных, хранилищ объектов, индексов и ключей задаёт сайт, и они сами могут содержать личные данные.",
      longNames: "Базы данных и хранилища объектов с именами длиннее 512 символов не показываются.",
      valuesIncluded: "Предпросмотр записей ограничен и может содержать личные данные приложения.",
      valuesOmitted: "Значения записей не показываются.",
      readOnly: "Этот инспектор только читает IndexedDB и никогда его не изменяет и не очищает."
    }
  },
  "uk-UA": {
    performance: {
      lcpPhases: "Фази LCP — це вимірювання часу браузером, а не доказ причини. Відсутні або обмежені дані позначаються явно; фази після відновлення сторінки та під час м’якої навігації не визначаються.",
      localSample: "Це один локальний зразок поточного відвідування, а не польові дані й не результат CrUX за 75-м процентилем.",
      inpUnavailable: "INP недоступний, доки сторінка не отримає відповідну взаємодію; деякі метрики недоступні для фонових або дуже коротких відвідувань.",
      longAnimationFrames: "Атрибуція довгих кадрів анімації вказує точки входу скриптів, а не обов’язково найповільнішу внутрішню функцію.",
      crossOrigin: "Фрейми інших джерел, воркери, service worker і код ізольованих світів можуть виконувати роботу без прив’язки до скрипту.",
      userTimings: "Назви користувацьких позначок часу задає сторінка, і вони очищаються; довільні об’єкти деталей, стеки викликів і вихідний код пропускаються.",
      layoutShifts: "Зміщення компонування одразу після введення не враховуються. Сума їхніх оцінок слугує для діагностики й може відрізнятися від CLS, обчисленого за вікнами сеансу.",
      baselineUrl: "Адреса базового вимірювання відрізняється від цього вимірювання; порівнюйте, лише якщо перехід був навмисним.",
      environment: "Середовище браузера відрізняється від базового вимірювання; зміни області перегляду, сповільнення, кешу, заголовків або мови можуть вплинути на різницю.",
      deltas: "Різниця «до і після» порівнює два локальні зразки й може містити звичайний розкид між запусками; повторюйте важливі вимірювання за однакових умов."
    },
    accessibilityComparison: {
      urlChanged: "Адреса сторінки змінилася після базового аудиту доступності.",
      scopeChanged: "Змінилися стандарт, селектор або обмеження збирання аудиту; установіть новий базовий рівень для цієї області.",
      engineChanged: "Змінився рушій аудиту; установіть новий базовий рівень перед порівнянням проблем.",
      baselineTruncated: "Базовий аудит було скорочено, тому нові проблеми не можна визначити надійно.",
      currentTruncated: "Поточний аудит було скорочено, тому розв’язані проблеми не можна визначити надійно."
    },
    indexedDb: {
      origin: "Враховано лише це джерело верхнього рівня; бази даних сторонніх фреймів не включено.",
      snapshot: "Бази даних і записи — це знімок на певну мить. Оновіть після того, як вебсайт змінить IndexedDB.",
      names: "Назви баз даних, сховищ об’єктів, індексів і ключів задає вебсайт, і вони самі можуть містити приватні дані.",
      longNames: "Бази даних і сховища об’єктів із назвами, довшими за 512 символів, не показуються.",
      valuesIncluded: "Попередній перегляд записів обмежений і може містити приватні дані застосунку.",
      valuesOmitted: "Значення записів не показуються.",
      readOnly: "Цей інспектор лише читає IndexedDB і ніколи його не змінює й не очищає."
    }
  }
}

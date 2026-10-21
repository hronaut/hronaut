// Report caveats for Page performance, the Accessibility audit comparison, the IndexedDB inspector and Site storage, keyed as
// PERFORMANCE_REPORT_CAVEATS, PERFORMANCE_COMPARISON_CAVEATS (src/shared/performance-audit.ts),
// ACCESSIBILITY_COMPARISON_CAVEATS (src/shared/accessibility-comparison.ts), INDEXEDDB_CAVEATS (src/shared/indexeddb.ts),
// STORAGE_USAGE_CAVEATS (src/shared/storage-usage.ts), STORAGE_CHANGES_CAVEATS (src/shared/storage-changes.ts) and
// PWA_INSPECTION_CAVEATS (src/shared/pwa.ts). Reports address agents; here the same points are worded for the person
// reading the panel.
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
    },
    storageUsage: {
      estimates: "Usage and quota are point-in-time browser estimates and may change as Chromium evicts or writes data.",
      quota: "Quota is the budget Chromium currently reports for this origin, not the free space on the device.",
      origin: "Only this top-level HTTP(S) origin is covered; third-party and partitioned storage can be counted separately.",
      aggregates: "Only total byte counts and the browser's storage categories are shown. Keys, values, file names and response bodies are never included.",
      readOnly: "This inspector only reads storage usage and never changes or clears data.",
      fallback: "Chromium's detailed quota breakdown was unavailable, so this report uses the browser's overall estimate: {reason}"
    },
    storageChanges: {
      baseline: "The baseline stays only in memory and is discarded when you clear it, when the tab changes origin or closes, or when Hronaut exits.",
      scope: "Local storage and cookies are shared by origin within this workspace and isolated from other workspaces; session storage belongs only to this tab.",
      valuesIncluded: "Values are shown up to a size limit. HttpOnly cookie values always stay protected.",
      valuesOmitted: "Values are left out.",
      snapshot: "The snapshot covers the first 200 sorted entries of each storage kind. Storage can also change in the background between the baseline and the comparison."
    },
    pwa: {
      origin: "Only this top-level origin is covered; workers and caches in third-party frames are not included.",
      snapshot: "Registrations and cached entries are a point-in-time snapshot. Refresh after the website changes its offline state.",
      manifest: "The manifest is read into a few bounded fields; its raw source is never shown.",
      installabilityIds: "Installability error identifiers come from Chromium and can change between Chromium versions.",
      readOnly: "This inspector only reads offline data and never shows cached response bodies.",
      headersIncluded: "Request and response headers are shown up to a limit; recognized secret-bearing headers are redacted.",
      headersOmitted: "Header values are left out.",
      opaqueSizes: "Sizes of opaque responses can include the browser's quota padding and are not measured here.",
      clearing: "This inspector never unregisters workers or clears caches.",
      installabilityUnavailable: "Installability diagnostics were unavailable: {reason}"
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
    },
    storageUsage: {
      estimates: "Nutzung und Kontingent sind Momentaufnahmen, die der Browser schätzt, und können sich ändern, wenn Chromium Daten entfernt oder schreibt.",
      quota: "Das Kontingent ist das Budget, das Chromium derzeit für diesen Ursprung meldet, nicht der freie Speicherplatz des Geräts.",
      origin: "Nur dieser Top-Level-HTTP(S)-Ursprung wird erfasst; Speicher von Drittanbietern und partitionierter Speicher können getrennt gezählt werden.",
      aggregates: "Angezeigt werden nur Gesamtgrößen in Bytes und die Speicherkategorien des Browsers. Schlüssel, Werte, Dateinamen und Antworttexte sind nie enthalten.",
      readOnly: "Diese Ansicht liest die Speichernutzung nur und ändert oder löscht keine Daten.",
      fallback: "Die detaillierte Kontingentaufschlüsselung von Chromium war nicht verfügbar, daher verwendet dieser Bericht die Gesamtschätzung des Browsers: {reason}"
    },
    storageChanges: {
      baseline: "Der Ausgangszustand bleibt nur im Speicher und wird verworfen, wenn Sie ihn löschen, wenn der Tab den Ursprung wechselt oder geschlossen wird oder wenn Hronaut beendet wird.",
      scope: "Lokaler Speicher und Cookies werden pro Ursprung innerhalb dieses Arbeitsbereichs geteilt und von anderen Arbeitsbereichen getrennt; der Sitzungsspeicher gehört nur zu diesem Tab.",
      valuesIncluded: "Werte werden bis zu einer Größengrenze angezeigt. Werte von HttpOnly-Cookies bleiben immer geschützt.",
      valuesOmitted: "Werte werden ausgelassen.",
      snapshot: "Der Schnappschuss umfasst die ersten 200 sortierten Einträge je Speicherart. Der Speicher kann sich zwischen Ausgangszustand und Vergleich auch im Hintergrund ändern."
    },
    pwa: {
      origin: "Nur dieser Top-Level-Ursprung wird erfasst; Worker und Caches in Frames von Drittanbietern sind nicht enthalten.",
      snapshot: "Registrierungen und zwischengespeicherte Einträge sind eine Momentaufnahme. Aktualisieren Sie, nachdem die Website ihren Offline-Zustand geändert hat.",
      manifest: "Das Manifest wird in wenige begrenzte Felder gelesen; sein Quelltext wird nie angezeigt.",
      installabilityIds: "Die Kennungen von Installierbarkeitsfehlern stammen von Chromium und können sich zwischen Chromium-Versionen ändern.",
      readOnly: "Diese Ansicht liest Offline-Daten nur und zeigt nie zwischengespeicherte Antworttexte.",
      headersIncluded: "Anfrage- und Antwort-Header werden bis zu einer Grenze angezeigt; erkannte Header mit Geheimnissen werden geschwärzt.",
      headersOmitted: "Header-Werte werden ausgelassen.",
      opaqueSizes: "Größen opaker Antworten können das Kontingent-Padding des Browsers enthalten und werden hier nicht gemessen.",
      clearing: "Diese Ansicht meldet nie Worker ab und leert nie Caches.",
      installabilityUnavailable: "Installierbarkeitsdiagnosen waren nicht verfügbar: {reason}"
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
    },
    storageUsage: {
      estimates: "L’utilisation et le quota sont des estimations ponctuelles du navigateur et peuvent changer quand Chromium évince ou écrit des données.",
      quota: "Le quota est le budget que Chromium indique actuellement pour cette origine, pas l’espace libre de l’appareil.",
      origin: "Seule cette origine HTTP(S) de premier niveau est couverte ; le stockage tiers et partitionné peut être comptabilisé séparément.",
      aggregates: "Seuls les totaux en octets et les catégories de stockage du navigateur sont affichés. Les clés, valeurs, noms de fichiers et corps de réponse ne sont jamais inclus.",
      readOnly: "Cet inspecteur lit seulement l’utilisation du stockage, sans jamais modifier ni effacer de données.",
      fallback: "La répartition détaillée du quota de Chromium n’était pas disponible ; ce rapport utilise donc l’estimation globale du navigateur : {reason}"
    },
    storageChanges: {
      baseline: "L’état de référence reste uniquement en mémoire et est supprimé quand vous l’effacez, quand l’onglet change d’origine ou se ferme, ou quand Hronaut se ferme.",
      scope: "Le stockage local et les cookies sont partagés par origine dans cet espace de travail et isolés des autres espaces de travail ; le stockage de session n’appartient qu’à cet onglet.",
      valuesIncluded: "Les valeurs sont affichées jusqu’à une taille limite. Les valeurs des cookies HttpOnly restent toujours protégées.",
      valuesOmitted: "Les valeurs sont omises.",
      snapshot: "L’instantané couvre les 200 premières entrées triées de chaque type de stockage. Le stockage peut aussi changer en arrière-plan entre l’état de référence et la comparaison."
    },
    pwa: {
      origin: "Seule cette origine de premier niveau est couverte ; les workers et caches des cadres tiers ne sont pas inclus.",
      snapshot: "Les enregistrements et les entrées en cache sont un instantané. Actualisez après une modification de l’état hors ligne par le site.",
      manifest: "Le manifeste est lu dans quelques champs limités ; sa source brute n’est jamais affichée.",
      installabilityIds: "Les identifiants d’erreurs d’installabilité viennent de Chromium et peuvent changer d’une version de Chromium à l’autre.",
      readOnly: "Cet inspecteur lit seulement les données hors ligne et n’affiche jamais les corps de réponse en cache.",
      headersIncluded: "Les en-têtes de requête et de réponse sont affichés jusqu’à une limite ; les en-têtes reconnus comme contenant des secrets sont masqués.",
      headersOmitted: "Les valeurs des en-têtes sont omises.",
      opaqueSizes: "La taille des réponses opaques peut inclure le remplissage de quota du navigateur et n’est pas mesurée ici.",
      clearing: "Cet inspecteur ne désinscrit jamais de workers et ne vide jamais de caches.",
      installabilityUnavailable: "Les diagnostics d’installabilité n’étaient pas disponibles : {reason}"
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
    },
    storageUsage: {
      estimates: "El uso y la cuota son estimaciones puntuales del navegador y pueden cambiar cuando Chromium expulsa o escribe datos.",
      quota: "La cuota es el presupuesto que Chromium indica ahora para este origen, no el espacio libre del dispositivo.",
      origin: "Solo se incluye este origen HTTP(S) de nivel superior; el almacenamiento de terceros y el particionado pueden contabilizarse por separado.",
      aggregates: "Solo se muestran totales en bytes y las categorías de almacenamiento del navegador. Nunca se incluyen claves, valores, nombres de archivo ni cuerpos de respuesta.",
      readOnly: "Este inspector solo lee el uso del almacenamiento y nunca modifica ni borra datos.",
      fallback: "El desglose detallado de la cuota de Chromium no estaba disponible, así que este informe usa la estimación general del navegador: {reason}"
    },
    storageChanges: {
      baseline: "La referencia solo se guarda en memoria y se descarta cuando la borras, cuando la pestaña cambia de origen o se cierra, o cuando Hronaut se cierra.",
      scope: "El almacenamiento local y las cookies se comparten por origen dentro de este espacio de trabajo y están aislados de otros espacios de trabajo; el almacenamiento de sesión pertenece solo a esta pestaña.",
      valuesIncluded: "Los valores se muestran hasta un tamaño límite. Los valores de las cookies HttpOnly siempre siguen protegidos.",
      valuesOmitted: "Se omiten los valores.",
      snapshot: "La instantánea abarca las primeras 200 entradas ordenadas de cada tipo de almacenamiento. El almacenamiento también puede cambiar en segundo plano entre la referencia y la comparación."
    },
    pwa: {
      origin: "Solo se incluye este origen de nivel superior; no se incluyen los workers ni las cachés de marcos de terceros.",
      snapshot: "Los registros y las entradas en caché son una instantánea. Actualiza después de que el sitio cambie su estado sin conexión.",
      manifest: "El manifiesto se lee en unos pocos campos limitados; nunca se muestra su código fuente.",
      installabilityIds: "Los identificadores de errores de instalación vienen de Chromium y pueden cambiar entre versiones de Chromium.",
      readOnly: "Este inspector solo lee los datos sin conexión y nunca muestra cuerpos de respuesta en caché.",
      headersIncluded: "Los encabezados de solicitud y respuesta se muestran hasta un límite; los encabezados reconocidos que contienen secretos se ocultan.",
      headersOmitted: "Se omiten los valores de los encabezados.",
      opaqueSizes: "El tamaño de las respuestas opacas puede incluir el relleno de cuota del navegador y no se mide aquí.",
      clearing: "Este inspector nunca anula el registro de workers ni vacía cachés.",
      installabilityUnavailable: "El diagnóstico de instalación no estaba disponible: {reason}"
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
    },
    storageUsage: {
      estimates: "Użycie i limit to chwilowe szacunki przeglądarki i mogą się zmienić, gdy Chromium usuwa lub zapisuje dane.",
      quota: "Limit to budżet, który Chromium obecnie podaje dla tego źródła, a nie wolne miejsce na urządzeniu.",
      origin: "Uwzględniane jest tylko to źródło HTTP(S) najwyższego poziomu; pamięć innych firm i pamięć partycjonowana mogą być liczone osobno.",
      aggregates: "Pokazywane są tylko łączne liczby bajtów i kategorie pamięci przeglądarki. Klucze, wartości, nazwy plików i treści odpowiedzi nigdy nie są uwzględniane.",
      readOnly: "Ten inspektor tylko odczytuje użycie pamięci i nigdy nie zmienia ani nie czyści danych.",
      fallback: "Szczegółowy podział limitu z Chromium był niedostępny, więc ten raport używa ogólnego szacunku przeglądarki: {reason}"
    },
    storageChanges: {
      baseline: "Stan bazowy jest przechowywany tylko w pamięci i usuwany, gdy go wyczyścisz, gdy karta zmieni źródło lub zostanie zamknięta albo gdy Hronaut zostanie zamknięty.",
      scope: "Pamięć lokalna i pliki cookie są współdzielone według źródła w tym obszarze roboczym i odizolowane od innych obszarów roboczych; pamięć sesji należy tylko do tej karty.",
      valuesIncluded: "Wartości są pokazywane do limitu rozmiaru. Wartości plików cookie HttpOnly zawsze pozostają chronione.",
      valuesOmitted: "Wartości są pomijane.",
      snapshot: "Migawka obejmuje pierwsze 200 posortowanych wpisów każdego rodzaju pamięci. Pamięć może też zmienić się w tle między stanem bazowym a porównaniem."
    },
    pwa: {
      origin: "Uwzględniane jest tylko to źródło najwyższego poziomu; workery i pamięci podręczne ramek innych firm są pomijane.",
      snapshot: "Rejestracje i wpisy w pamięci podręcznej to migawka z danej chwili. Odśwież po zmianie stanu offline przez witrynę.",
      manifest: "Manifest jest odczytywany do kilku ograniczonych pól; jego surowe źródło nigdy nie jest pokazywane.",
      installabilityIds: "Identyfikatory błędów możliwości instalacji pochodzą z Chromium i mogą się zmieniać między wersjami Chromium.",
      readOnly: "Ten inspektor tylko odczytuje dane offline i nigdy nie pokazuje treści odpowiedzi z pamięci podręcznej.",
      headersIncluded: "Nagłówki żądań i odpowiedzi są pokazywane do limitu; rozpoznane nagłówki z sekretami są ukrywane.",
      headersOmitted: "Wartości nagłówków są pomijane.",
      opaqueSizes: "Rozmiary nieprzezroczystych odpowiedzi mogą obejmować dopełnienie limitu przeglądarki i nie są tu mierzone.",
      clearing: "Ten inspektor nigdy nie wyrejestrowuje workerów ani nie czyści pamięci podręcznych.",
      installabilityUnavailable: "Diagnostyka możliwości instalacji była niedostępna: {reason}"
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
    },
    storageUsage: {
      estimates: "Использование и квота — это текущие оценки браузера, и они могут меняться, когда Chromium вытесняет или записывает данные.",
      quota: "Квота — это бюджет, который Chromium сейчас сообщает для этого источника, а не свободное место на устройстве.",
      origin: "Учитывается только этот источник HTTP(S) верхнего уровня; стороннее и разделённое хранилище может учитываться отдельно.",
      aggregates: "Показываются только общие объёмы в байтах и категории хранилища браузера. Ключи, значения, имена файлов и тела ответов никогда не включаются.",
      readOnly: "Этот инспектор только читает использование хранилища и никогда не изменяет и не удаляет данные.",
      fallback: "Подробная разбивка квоты от Chromium была недоступна, поэтому в отчёте используется общая оценка браузера: {reason}"
    },
    storageChanges: {
      baseline: "Базовое состояние хранится только в памяти и удаляется, когда вы его очищаете, когда вкладка меняет источник или закрывается либо когда Hronaut завершает работу.",
      scope: "Локальное хранилище и файлы cookie общие для источника в этом рабочем пространстве и изолированы от других рабочих пространств; сеансовое хранилище принадлежит только этой вкладке.",
      valuesIncluded: "Значения показываются до ограничения по размеру. Значения файлов cookie HttpOnly всегда остаются защищёнными.",
      valuesOmitted: "Значения не показываются.",
      snapshot: "Снимок охватывает первые 200 отсортированных записей каждого типа хранилища. Хранилище также может измениться в фоне между базовым состоянием и сравнением."
    },
    pwa: {
      origin: "Учитывается только этот источник верхнего уровня; воркеры и кеши сторонних фреймов не включаются.",
      snapshot: "Регистрации и записи кеша — это снимок на определённый момент. Обновите после того, как сайт изменит своё офлайн-состояние.",
      manifest: "Манифест читается в несколько ограниченных полей; его исходный текст никогда не показывается.",
      installabilityIds: "Идентификаторы ошибок возможности установки предоставляет Chromium, и они могут меняться между версиями Chromium.",
      readOnly: "Этот инспектор только читает офлайн-данные и никогда не показывает тела ответов из кеша.",
      headersIncluded: "Заголовки запросов и ответов показываются до ограничения; распознанные заголовки с секретами скрываются.",
      headersOmitted: "Значения заголовков не показываются.",
      opaqueSizes: "Размеры непрозрачных ответов могут включать дополнение квоты браузера и здесь не измеряются.",
      clearing: "Этот инспектор никогда не отменяет регистрацию воркеров и не очищает кеши.",
      installabilityUnavailable: "Диагностика возможности установки была недоступна: {reason}"
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
    },
    storageUsage: {
      estimates: "Використання й квота — це поточні оцінки браузера, і вони можуть змінюватися, коли Chromium витісняє або записує дані.",
      quota: "Квота — це бюджет, який Chromium зараз повідомляє для цього джерела, а не вільне місце на пристрої.",
      origin: "Враховано лише це джерело HTTP(S) верхнього рівня; стороннє й розділене сховище може обліковуватися окремо.",
      aggregates: "Показуються лише загальні обсяги в байтах і категорії сховища браузера. Ключі, значення, назви файлів і тіла відповідей ніколи не включаються.",
      readOnly: "Цей інспектор лише читає використання сховища й ніколи не змінює й не очищає дані.",
      fallback: "Детальний розподіл квоти від Chromium був недоступний, тому звіт використовує загальну оцінку браузера: {reason}"
    },
    storageChanges: {
      baseline: "Базовий стан зберігається лише в пам’яті й видаляється, коли ви його очищаєте, коли вкладка змінює джерело чи закривається або коли Hronaut завершує роботу.",
      scope: "Локальне сховище й файли cookie спільні для джерела в цьому робочому просторі та ізольовані від інших робочих просторів; сеансове сховище належить лише цій вкладці.",
      valuesIncluded: "Значення показуються до обмеження за розміром. Значення файлів cookie HttpOnly завжди залишаються захищеними.",
      valuesOmitted: "Значення не показуються.",
      snapshot: "Знімок охоплює перші 200 відсортованих записів кожного типу сховища. Сховище також може змінитися у фоні між базовим станом і порівнянням."
    },
    pwa: {
      origin: "Враховано лише це джерело верхнього рівня; воркери й кеші сторонніх фреймів не включено.",
      snapshot: "Реєстрації та записи кешу — це знімок на певну мить. Оновіть після того, як вебсайт змінить свій офлайн-стан.",
      manifest: "Маніфест читається в кілька обмежених полів; його вихідний текст ніколи не показується.",
      installabilityIds: "Ідентифікатори помилок можливості встановлення надає Chromium, і вони можуть змінюватися між версіями Chromium.",
      readOnly: "Цей інспектор лише читає офлайн-дані й ніколи не показує тіла відповідей із кешу.",
      headersIncluded: "Заголовки запитів і відповідей показуються до обмеження; розпізнані заголовки із секретами приховуються.",
      headersOmitted: "Значення заголовків не показуються.",
      opaqueSizes: "Розміри непрозорих відповідей можуть містити доповнення квоти браузера й тут не вимірюються.",
      clearing: "Цей інспектор ніколи не скасовує реєстрацію воркерів і не очищає кеші.",
      installabilityUnavailable: "Діагностика можливості встановлення була недоступна: {reason}"
    }
  }
}

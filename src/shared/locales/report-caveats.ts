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
  },
  "it-IT": {
    performance: {
      lcpPhases: "Le fasi LCP sono osservazioni dei tempi del browser, non prove di causalità. Le prove mancanti o limitate vengono indicate esplicitamente; l’attribuzione delle fasi per ripristini e navigazioni soft non è supportata.",
      localSample: "Questo è un singolo campione locale della visita attuale, non dati sul campo né un risultato CrUX al 75° percentile.",
      inpUnavailable: "L’INP non è disponibile finché la pagina non riceve un’interazione idonea; alcune metriche non sono disponibili per visite in background o di breve durata.",
      longAnimationFrames: "L’attribuzione dei frame di animazione lunghi identifica i punti di ingresso degli script, non necessariamente la funzione interna più lenta.",
      crossOrigin: "Frame multiorigine, worker, service worker e codice in mondi isolati possono contribuire al lavoro senza attribuzione agli script.",
      userTimings: "I nomi User Timing sono definiti dalla pagina e ripuliti; oggetti di dettaglio arbitrari, stack trace e codice sorgente vengono omessi.",
      layoutShifts: "Le prove sugli spostamenti del layout escludono le voci con input discreti recenti. La somma dei punteggi è diagnostica e può differire dal punteggio CLS per finestra di sessione.",
      baselineUrl: "L’URL di riferimento è diverso da quello di questa misurazione; confrontali solo se la modifica alla navigazione era intenzionale.",
      environment: "L’ambiente del browser è diverso da quello di riferimento; modifiche ad area visibile, limitazione, cache, intestazioni o impostazioni internazionali possono influire sulla differenza.",
      deltas: "Le differenze prima/dopo confrontano due campioni locali e possono includere la normale variazione tra un’esecuzione e l’altra; ripeti le misurazioni importanti in condizioni equivalenti."
    },
    accessibilityComparison: {
      urlChanged: "L’URL della pagina è cambiato dopo il riferimento di accessibilità.",
      scopeChanged: "Lo standard di accessibilità, il selettore o i limiti di raccolta sono cambiati; imposta un nuovo riferimento per questo ambito.",
      engineChanged: "Il motore di accessibilità è cambiato; imposta un nuovo riferimento prima di confrontare i risultati.",
      baselineTruncated: "Il riferimento è stato troncato, quindi non è possibile determinare in modo sicuro i nuovi risultati.",
      currentTruncated: "Il controllo attuale è stato troncato, quindi non è possibile determinare in modo sicuro i risultati risolti."
    },
    indexedDb: {
      origin: "È coperta solo questa origine di primo livello; i database nei frame di terze parti non sono inclusi.",
      snapshot: "Database e record sono uno snapshot di un preciso momento. Aggiorna dopo che il sito web ha modificato IndexedDB.",
      names: "I nomi di database, archivi di oggetti, indici e chiavi sono scritti dal sito web e possono contenere essi stessi dati privati.",
      longNames: "I database e gli archivi di oggetti con nomi più lunghi di 512 caratteri vengono esclusi.",
      valuesIncluded: "Le anteprime dei record sono limitate e possono contenere dati privati dell’applicazione.",
      valuesOmitted: "I valori dei record vengono esclusi.",
      readOnly: "Questo strumento di ispezione legge soltanto IndexedDB e non lo modifica né lo cancella mai."
    },
    storageUsage: {
      estimates: "Utilizzo e quota sono stime del browser relative a un preciso momento e possono cambiare quando Chromium rimuove o scrive dati.",
      quota: "La quota è il budget che Chromium indica attualmente per questa origine, non lo spazio libero sul dispositivo.",
      origin: "È coperta solo questa origine HTTP(S) di primo livello; l’archiviazione di terze parti e partizionata può essere conteggiata separatamente.",
      aggregates: "Vengono mostrati solo i conteggi totali dei byte e le categorie di archiviazione del browser. Chiavi, valori, nomi di file e corpi delle risposte non sono mai inclusi.",
      readOnly: "Questo strumento di ispezione legge soltanto l’utilizzo dello spazio di archiviazione e non modifica né cancella mai i dati.",
      fallback: "La ripartizione dettagliata della quota di Chromium non era disponibile, quindi questo report usa la stima complessiva del browser: {reason}"
    },
    storageChanges: {
      baseline: "Il riferimento resta solo in memoria e viene eliminato quando lo cancelli, quando la scheda cambia origine o viene chiusa, oppure quando esci da Hronaut.",
      scope: "L’archiviazione locale e i cookie sono condivisi per origine all’interno di quest’area di lavoro e isolati dalle altre aree di lavoro; l’archiviazione di sessione appartiene solo a questa scheda.",
      valuesIncluded: "I valori vengono mostrati fino a un limite di dimensione. I valori dei cookie HttpOnly restano sempre protetti.",
      valuesOmitted: "I valori vengono esclusi.",
      snapshot: "Lo snapshot copre le prime 200 voci ordinate di ogni tipo di archiviazione. L’archiviazione può anche cambiare in background tra il riferimento e il confronto."
    },
    pwa: {
      origin: "È coperta solo questa origine di primo livello; i worker e le cache nei frame di terze parti non sono inclusi.",
      snapshot: "Registrazioni e voci memorizzate nella cache sono uno snapshot di un preciso momento. Aggiorna dopo che il sito web ha modificato il suo stato offline.",
      manifest: "Il manifest viene letto in alcuni campi limitati; la sua origine non elaborata non viene mai mostrata.",
      installabilityIds: "Gli identificatori degli errori di installabilità provengono da Chromium e possono cambiare tra una versione di Chromium e l’altra.",
      readOnly: "Questo strumento di ispezione legge soltanto i dati offline e non mostra mai i corpi delle risposte memorizzate nella cache.",
      headersIncluded: "Le intestazioni di richiesta e risposta vengono mostrate fino a un limite; le intestazioni riconosciute come contenenti segreti vengono oscurate.",
      headersOmitted: "I valori delle intestazioni vengono esclusi.",
      opaqueSizes: "Le dimensioni delle risposte opache possono includere il riempimento della quota del browser e qui non vengono misurate.",
      clearing: "Questo strumento di ispezione non annulla mai la registrazione dei worker né svuota le cache.",
      installabilityUnavailable: "La diagnostica di installabilità non era disponibile: {reason}"
    }
  },
  "pt-BR": {
    performance: {
      lcpPhases: "As fases do LCP são observações de tempo do navegador, não provas de causa. Evidências ausentes ou restritas são indicadas explicitamente; a atribuição de fases em restaurações e em navegações suaves não é compatível.",
      localSample: "Esta é uma única amostra local da visita atual, não dados de campo nem um resultado do CrUX no 75º percentil.",
      inpUnavailable: "O INP fica indisponível até que a página receba uma interação qualificada; algumas métricas ficam indisponíveis em visitas em segundo plano ou de curta duração.",
      longAnimationFrames: "A atribuição de quadros de animação longos identifica os pontos de entrada dos scripts, não necessariamente a função interna mais lenta.",
      crossOrigin: "Frames de origem cruzada, workers, service workers e código em mundos isolados podem contribuir com trabalho sem atribuição a scripts.",
      userTimings: "Os nomes de User Timing são criados pela página e sanitizados; objetos de detalhe arbitrários, rastreamentos de pilha e código-fonte são omitidos.",
      layoutShifts: "As evidências de mudança de layout desconsideram entradas com entrada discreta recente. A soma das pontuações é diagnóstica e pode diferir da pontuação de CLS por janela de sessão.",
      baselineUrl: "O URL da referência é diferente desta medição; compare somente se a mudança de navegação foi intencional.",
      environment: "O ambiente do navegador é diferente da referência; mudanças de área de visualização, limitação, cache, cabeçalhos ou localidade podem afetar a diferença.",
      deltas: "As diferenças de antes e depois comparam duas amostras locais e podem incluir a variação normal entre execuções; repita medições importantes em condições equivalentes."
    },
    accessibilityComparison: {
      urlChanged: "O URL da página mudou depois da referência de acessibilidade.",
      scopeChanged: "O padrão de acessibilidade, o seletor ou os limites de coleta mudaram; defina uma nova referência para este escopo.",
      engineChanged: "O mecanismo de acessibilidade mudou; defina uma nova referência antes de comparar constatações.",
      baselineTruncated: "A referência foi truncada, então não é possível determinar com segurança as novas constatações.",
      currentTruncated: "A auditoria atual foi truncada, então não é possível determinar com segurança as constatações resolvidas."
    },
    indexedDb: {
      origin: "Somente esta origem de nível superior é coberta; bancos de dados em frames de terceiros não são incluídos.",
      snapshot: "Os bancos de dados e registros são um snapshot de um momento específico. Atualize depois que o site alterar o IndexedDB.",
      names: "Os nomes de bancos de dados, object stores, índices e chaves são escritos pelo site e podem conter dados privados.",
      longNames: "Bancos de dados e object stores com nomes de mais de 512 caracteres são deixados de fora.",
      valuesIncluded: "As prévias de registros são limitadas e podem conter dados privados do aplicativo.",
      valuesOmitted: "Os valores dos registros são deixados de fora.",
      readOnly: "Este inspetor só lê o IndexedDB e nunca o altera nem o limpa."
    },
    storageUsage: {
      estimates: "O uso e a cota são estimativas do navegador em um momento específico e podem mudar à medida que o Chromium remove ou grava dados.",
      quota: "A cota é o orçamento que o Chromium informa no momento para esta origem, não o espaço livre no dispositivo.",
      origin: "Somente esta origem HTTP(S) de nível superior é coberta; o armazenamento de terceiros e particionado pode ser contado separadamente.",
      aggregates: "Somente as contagens totais de bytes e as categorias de armazenamento do navegador são mostradas. Chaves, valores, nomes de arquivos e corpos de respostas nunca são incluídos.",
      readOnly: "Este inspetor só lê o uso do armazenamento e nunca altera nem limpa dados.",
      fallback: "O detalhamento da cota do Chromium não estava disponível, então este relatório usa a estimativa geral do navegador: {reason}"
    },
    storageChanges: {
      baseline: "A referência fica somente na memória e é descartada quando você a limpa, quando a guia muda de origem ou é fechada, ou quando o Hronaut é encerrado.",
      scope: "O armazenamento local e os cookies são compartilhados por origem neste espaço de trabalho e isolados dos outros espaços de trabalho; o armazenamento de sessão pertence somente a esta guia.",
      valuesIncluded: "Os valores são mostrados até um limite de tamanho. Os valores de cookies HttpOnly sempre continuam protegidos.",
      valuesOmitted: "Os valores são deixados de fora.",
      snapshot: "O snapshot cobre as primeiras 200 entradas ordenadas de cada tipo de armazenamento. O armazenamento também pode mudar em segundo plano entre a referência e a comparação."
    },
    pwa: {
      origin: "Somente esta origem de nível superior é coberta; workers e caches em frames de terceiros não são incluídos.",
      snapshot: "Os registros e as entradas em cache são um snapshot de um momento específico. Atualize depois que o site alterar o estado off-line.",
      manifest: "O manifesto é lido em alguns campos limitados; o código-fonte bruto dele nunca é mostrado.",
      installabilityIds: "Os identificadores de erros de instalabilidade vêm do Chromium e podem mudar entre versões do Chromium.",
      readOnly: "Este inspetor só lê dados off-line e nunca mostra corpos de respostas em cache.",
      headersIncluded: "Os cabeçalhos de solicitação e resposta são mostrados até um limite; cabeçalhos reconhecidos que contêm segredos são ocultados.",
      headersOmitted: "Os valores dos cabeçalhos são deixados de fora.",
      opaqueSizes: "Os tamanhos de respostas opacas podem incluir o preenchimento de cota do navegador e não são medidos aqui.",
      clearing: "Este inspetor nunca cancela o registro de workers nem limpa caches.",
      installabilityUnavailable: "O diagnóstico de instalabilidade não estava disponível: {reason}"
    }
  },
  "tr-TR": {
    performance: {
      lcpPhases: "LCP aşamaları tarayıcı zamanlama gözlemleridir, nedensellik kanıtı değildir. Eksik veya kısıtlı kanıtlar açıkça belirtilir; geri yükleme ve soft navigation aşama ilişkilendirmesi desteklenmez.",
      localSample: "Bu, geçerli ziyarete ait tek bir yerel örnektir; saha verisi veya 75. yüzdelik CrUX sonucu değildir.",
      inpUnavailable: "INP, sayfa uygun bir etkileşim alana kadar kullanılamaz; arka planda kalan veya kısa süren ziyaretlerde bazı metrikler kullanılamaz.",
      longAnimationFrames: "Uzun animasyon karesi ilişkilendirmesi, en yavaş iç işlevi değil, komut dosyası giriş noktalarını belirler.",
      crossOrigin: "Kaynaklar arası çerçeveler, worker’lar, service worker’lar ve yalıtılmış dünya kodu, komut dosyası ilişkilendirmesi olmadan iş yüküne katkıda bulunabilir.",
      userTimings: "User Timing adları sayfa tarafından yazılır ve temizlenir; rastgele ayrıntı nesneleri, yığın izleri ve kaynak kodu çıkarılır.",
      layoutShifts: "Düzen kayması kanıtı, yakın zamanda ayrık giriş yapılan girdileri hariç tutar. Puan toplamı tanılama amaçlıdır ve CLS oturum penceresi puanlamasından farklı olabilir.",
      baselineUrl: "Referans URL’si bu ölçümden farklı; yalnızca gezinme değişikliği bilinçliyse karşılaştırın.",
      environment: "Tarayıcı ortamı referanstan farklı; görüntü alanı, kısıtlama, önbellek, başlık veya yerel ayar değişiklikleri farkı etkileyebilir.",
      deltas: "Önce ve sonra farkları iki yerel örneği karşılaştırır ve çalıştırmalar arasındaki olağan değişimi içerebilir; önemli ölçümleri aynı koşullar altında tekrarlayın."
    },
    accessibilityComparison: {
      urlChanged: "Erişilebilirlik referansından sonra sayfa URL’si değişti.",
      scopeChanged: "Erişilebilirlik standardı, seçici veya toplama sınırları değişti; bu kapsam için yeni bir referans belirleyin.",
      engineChanged: "Erişilebilirlik motoru değişti; bulguları karşılaştırmadan önce yeni bir referans belirleyin.",
      baselineTruncated: "Referans kısaltıldığı için yeni bulgular güvenli şekilde belirlenemez.",
      currentTruncated: "Geçerli denetim kısaltıldığı için çözülen bulgular güvenli şekilde belirlenemez."
    },
    indexedDb: {
      origin: "Yalnızca bu üst düzey kaynak kapsanır; üçüncü taraf çerçevelerdeki veritabanları dahil değildir.",
      snapshot: "Veritabanları ve kayıtlar belirli bir andaki anlık görüntüdür. Web sitesi IndexedDB’yi değiştirdikten sonra yenileyin.",
      names: "Veritabanı, nesne deposu, dizin ve anahtar adlarını web sitesi yazar; bu adların kendisi de özel veriler içerebilir.",
      longNames: "Adı 512 karakterden uzun olan veritabanları ve nesne depoları dışarıda bırakılır.",
      valuesIncluded: "Kayıt önizlemeleri sınırlıdır ve özel uygulama verileri içerebilir.",
      valuesOmitted: "Kayıt değerleri dışarıda bırakılır.",
      readOnly: "Bu denetçi IndexedDB’yi yalnızca okur; hiçbir zaman değiştirmez veya temizlemez."
    },
    storageUsage: {
      estimates: "Kullanım ve kota, belirli bir andaki tarayıcı tahminleridir; Chromium veri çıkardıkça veya yazdıkça değişebilir.",
      quota: "Kota, Chromium’un bu kaynak için şu anda bildirdiği bütçedir; cihazdaki boş alan değildir.",
      origin: "Yalnızca bu üst düzey HTTP(S) kaynağı kapsanır; üçüncü taraf ve bölümlenmiş depolama ayrı sayılabilir.",
      aggregates: "Yalnızca toplam bayt sayıları ve tarayıcının depolama kategorileri gösterilir. Anahtarlar, değerler, dosya adları ve yanıt gövdeleri hiçbir zaman dahil edilmez.",
      readOnly: "Bu denetçi depolama kullanımını yalnızca okur; verileri hiçbir zaman değiştirmez veya temizlemez.",
      fallback: "Chromium’un ayrıntılı kota dökümü kullanılamadığı için bu rapor tarayıcının genel tahminini kullanıyor: {reason}"
    },
    storageChanges: {
      baseline: "Referans yalnızca bellekte tutulur; siz temizlediğinizde, sekmenin kaynağı değiştiğinde veya sekme kapandığında ya da Hronaut’tan çıkıldığında silinir.",
      scope: "Yerel depolama ve çerezler bu çalışma alanında kaynağa göre paylaşılır ve diğer çalışma alanlarından yalıtılır; oturum depolaması yalnızca bu sekmeye aittir.",
      valuesIncluded: "Değerler bir boyut sınırına kadar gösterilir. HttpOnly çerez değerleri her zaman korunur.",
      valuesOmitted: "Değerler dışarıda bırakılır.",
      snapshot: "Anlık görüntü, her depolama türünün sıralanmış ilk 200 girişini kapsar. Depolama, referans ile karşılaştırma arasında arka planda da değişebilir."
    },
    pwa: {
      origin: "Yalnızca bu üst düzey kaynak kapsanır; üçüncü taraf çerçevelerdeki worker’lar ve önbellekler dahil değildir.",
      snapshot: "Kayıtlar ve önbelleğe alınmış girişler belirli bir andaki anlık görüntüdür. Web sitesi çevrimdışı durumunu değiştirdikten sonra yenileyin.",
      manifest: "Manifest, sınırlı sayıda alana okunur; ham kaynağı hiçbir zaman gösterilmez.",
      installabilityIds: "Yüklenebilirlik hatası tanımlayıcıları Chromium’dan gelir ve Chromium sürümleri arasında değişebilir.",
      readOnly: "Bu denetçi çevrimdışı verileri yalnızca okur; önbelleğe alınmış yanıt gövdelerini hiçbir zaman göstermez.",
      headersIncluded: "İstek ve yanıt başlıkları bir sınıra kadar gösterilir; gizli bilgi taşıdığı bilinen başlıklar gizlenir.",
      headersOmitted: "Başlık değerleri dışarıda bırakılır.",
      opaqueSizes: "Opak yanıtların boyutları tarayıcının kota dolgusunu içerebilir ve burada ölçülmez.",
      clearing: "Bu denetçi hiçbir zaman worker kayıtlarını silmez veya önbellekleri temizlemez.",
      installabilityUnavailable: "Yüklenebilirlik tanılamaları kullanılamadı: {reason}"
    }
  },
  "hi-IN": {
    performance: {
      lcpPhases: "LCP के चरण, ब्राउज़र की टाइमिंग से जुड़े ऑब्ज़र्वेशन हैं, वजह का सबूत नहीं। मौजूद न होने वाले या सीमित सबूत साफ़ तौर पर बताए जाते हैं; रीस्टोर और सॉफ़्ट नेविगेशन के लिए चरणों की वजह बताना काम नहीं करता।",
      localSample: "यह मौजूदा विज़िट का एक लोकल सैंपल है, फ़ील्ड डेटा या 75वें पर्सेंटाइल का CrUX नतीजा नहीं।",
      inpUnavailable: "जब तक पेज को कोई योग्य इंटरैक्शन नहीं मिलता, तब तक INP उपलब्ध नहीं होता; बैकग्राउंड या कम समय की विज़िट के लिए कुछ मेट्रिक उपलब्ध नहीं होतीं।",
      longAnimationFrames: "लंबे ऐनिमेशन फ़्रेम की वजह बताने से स्क्रिप्ट के एंट्री पॉइंट पता चलते हैं, ज़रूरी नहीं कि सबसे धीमा अंदरूनी फ़ंक्शन।",
      crossOrigin: "क्रॉस-ऑरिजिन फ़्रेम, वर्कर, सर्विस वर्कर और अलग वर्ल्ड वाला कोड, स्क्रिप्ट की वजह बताए बिना भी काम में योगदान दे सकता है।",
      userTimings: "User Timing के नाम पेज के लिखे होते हैं और साफ़ किए जाते हैं; मनचाहे डिटेल ऑब्जेक्ट, स्टैक ट्रेस और सोर्स कोड छोड़ दिए जाते हैं।",
      layoutShifts: "लेआउट शिफ़्ट के सबूत में हाल के अलग इनपुट वाली एंट्री शामिल नहीं होतीं। इसके स्कोर का जोड़ डायग्नोस्टिक है और CLS की सेशन-विंडो स्कोरिंग से अलग हो सकता है।",
      baselineUrl: "बेसलाइन का URL इस माप से अलग है; तुलना सिर्फ़ तभी करें, जब नेविगेशन में बदलाव जान-बूझकर किया गया हो।",
      environment: "ब्राउज़र एनवायरमेंट बेसलाइन से अलग है; व्यूपोर्ट, थ्रॉटलिंग, कैश, हेडर या लोकेल में बदलाव से अंतर पर असर पड़ सकता है।",
      deltas: "पहले और बाद के अंतर दो लोकल सैंपल की तुलना करते हैं और इनमें हर बार चलाने पर होने वाला सामान्य फ़र्क भी हो सकता है; ज़रूरी मापों को मिलती-जुलती स्थितियों में दोहराएं।"
    },
    accessibilityComparison: {
      urlChanged: "सुलभता की बेसलाइन के बाद पेज का URL बदल गया।",
      scopeChanged: "सुलभता का स्टैंडर्ड, सिलेक्टर या इकट्ठा करने की सीमाएं बदल गईं; इस दायरे के लिए नई बेसलाइन सेट करें।",
      engineChanged: "सुलभता इंजन बदल गया; नतीजों की तुलना करने से पहले नई बेसलाइन सेट करें।",
      baselineTruncated: "बेसलाइन को छोटा कर दिया गया था, इसलिए नए नतीजे सुरक्षित तरीके से तय नहीं किए जा सकते।",
      currentTruncated: "मौजूदा ऑडिट को छोटा कर दिया गया था, इसलिए हल हुए नतीजे सुरक्षित तरीके से तय नहीं किए जा सकते।"
    },
    indexedDb: {
      origin: "सिर्फ़ यह टॉप-लेवल ऑरिजिन शामिल है; तीसरे पक्ष के फ़्रेम के डेटाबेस शामिल नहीं हैं।",
      snapshot: "डेटाबेस और रिकॉर्ड किसी एक समय का स्नैपशॉट हैं। वेबसाइट के IndexedDB बदलने के बाद रीफ़्रेश करें।",
      names: "डेटाबेस, ऑब्जेक्ट स्टोर, इंडेक्स और कुंजी के नाम वेबसाइट लिखती है और इनमें खुद भी निजी डेटा हो सकता है।",
      longNames: "512 वर्णों से लंबे नाम वाले डेटाबेस और ऑब्जेक्ट स्टोर छोड़ दिए जाते हैं।",
      valuesIncluded: "रिकॉर्ड की झलक सीमित होती है और इसमें ऐप्लिकेशन का निजी डेटा हो सकता है।",
      valuesOmitted: "रिकॉर्ड की वैल्यू छोड़ दी जाती हैं।",
      readOnly: "यह इंस्पेक्टर सिर्फ़ IndexedDB पढ़ता है और इसे कभी बदलता या साफ़ नहीं करता।"
    },
    storageUsage: {
      estimates: "इस्तेमाल और कोटा किसी एक समय पर ब्राउज़र के अनुमान हैं और Chromium के डेटा हटाने या लिखने पर बदल सकते हैं।",
      quota: "कोटा वह बजट है जो Chromium अभी इस ऑरिजिन के लिए बताता है, डिवाइस की खाली जगह नहीं।",
      origin: "सिर्फ़ यह टॉप-लेवल HTTP(S) ऑरिजिन शामिल है; तीसरे पक्ष और पार्टिशन किया गया स्टोरेज अलग से गिना जा सकता है।",
      aggregates: "सिर्फ़ कुल बाइट की संख्या और ब्राउज़र की स्टोरेज कैटगरी दिखाई जाती हैं। कुंजियां, वैल्यू, फ़ाइल के नाम और रिस्पॉन्स बॉडी कभी शामिल नहीं की जातीं।",
      readOnly: "यह इंस्पेक्टर सिर्फ़ स्टोरेज का इस्तेमाल पढ़ता है और डेटा को कभी बदलता या साफ़ नहीं करता।",
      fallback: "Chromium का कोटा का पूरा ब्यौरा उपलब्ध नहीं था, इसलिए यह रिपोर्ट ब्राउज़र के कुल अनुमान का इस्तेमाल करती है: {reason}"
    },
    storageChanges: {
      baseline: "बेसलाइन सिर्फ़ मेमोरी में रहती है और तब हटा दी जाती है, जब आप इसे साफ़ करते हैं, जब टैब का ऑरिजिन बदलता है या टैब बंद होता है, या जब Hronaut बंद होता है।",
      scope: "लोकल स्टोरेज और कुकी इस वर्कस्पेस में ऑरिजिन के हिसाब से शेयर होती हैं और दूसरे वर्कस्पेस से अलग रहती हैं; सेशन स्टोरेज सिर्फ़ इस टैब का होता है।",
      valuesIncluded: "वैल्यू एक तय साइज़ तक दिखाई जाती हैं। HttpOnly कुकी की वैल्यू हमेशा सुरक्षित रहती हैं।",
      valuesOmitted: "वैल्यू छोड़ दी जाती हैं।",
      snapshot: "स्नैपशॉट में हर तरह के स्टोरेज की क्रम से लगाई गई पहली 200 एंट्री शामिल होती हैं। बेसलाइन और तुलना के बीच, स्टोरेज बैकग्राउंड में भी बदल सकता है।"
    },
    pwa: {
      origin: "सिर्फ़ यह टॉप-लेवल ऑरिजिन शामिल है; तीसरे पक्ष के फ़्रेम के वर्कर और कैश शामिल नहीं हैं।",
      snapshot: "रजिस्ट्रेशन और कैश की गई एंट्री किसी एक समय का स्नैपशॉट हैं। वेबसाइट की ऑफ़लाइन स्थिति बदलने के बाद रीफ़्रेश करें।",
      manifest: "मेनिफ़ेस्ट को कुछ सीमित फ़ील्ड में पढ़ा जाता है; इसका रॉ सोर्स कभी नहीं दिखाया जाता।",
      installabilityIds: "इंस्टॉल करने से जुड़ी गड़बड़ियों के आइडेंटिफ़ायर Chromium से आते हैं और Chromium के वर्शन के साथ बदल सकते हैं।",
      readOnly: "यह इंस्पेक्टर सिर्फ़ ऑफ़लाइन डेटा पढ़ता है और कैश किए गए रिस्पॉन्स की बॉडी कभी नहीं दिखाता।",
      headersIncluded: "अनुरोध और रिस्पॉन्स के हेडर एक सीमा तक दिखाए जाते हैं; पहचाने गए सीक्रेट वाले हेडर छिपा दिए जाते हैं।",
      headersOmitted: "हेडर की वैल्यू छोड़ दी जाती हैं।",
      opaqueSizes: "ओपेक रिस्पॉन्स के साइज़ में ब्राउज़र के कोटा की पैडिंग शामिल हो सकती है और इन्हें यहां मापा नहीं जाता।",
      clearing: "यह इंस्पेक्टर कभी भी वर्कर का रजिस्ट्रेशन रद्द नहीं करता या कैश साफ़ नहीं करता।",
      installabilityUnavailable: "इंस्टॉल करने से जुड़ा डायग्नोस्टिक उपलब्ध नहीं था: {reason}"
    }
  },
  "ja-JP": {
    performance: {
      lcpPhases: "LCP のフェーズはブラウザのタイミングの観測値であり、因果関係の証明ではありません。欠落している証拠や制限された証拠は明示されます。復元とソフト ナビゲーションのフェーズの帰属はサポートされていません。",
      localSample: "これは現在のアクセスにおける 1 回のローカル サンプルであり、フィールド データや CrUX の 75 パーセンタイルの結果ではありません。",
      inpUnavailable: "INP は、ページが該当する操作を受け取るまで利用できません。バックグラウンドや短時間のアクセスでは、一部の指標を利用できません。",
      longAnimationFrames: "長いアニメーション フレームの帰属で特定されるのはスクリプトのエントリ ポイントであり、必ずしも内部で最も遅い関数ではありません。",
      crossOrigin: "クロスオリジンのフレーム、ワーカー、Service Worker、分離されたワールドのコードは、スクリプトの帰属なしで処理に影響する場合があります。",
      userTimings: "User Timing の名前はページが作成したもので、サニタイズされています。任意の detail オブジェクト、スタック トレース、ソースコードは除外されます。",
      layoutShifts: "レイアウト シフトの証拠からは、直近に個別の入力があったエントリが除外されます。そのスコアの合計は診断用で、CLS のセッション ウィンドウによるスコアとは異なる場合があります。",
      baselineUrl: "ベースラインの URL がこの測定と異なります。ナビゲーションの変更が意図的な場合にのみ比較してください。",
      environment: "ブラウザの環境がベースラインと異なります。表示領域、スロットリング、キャッシュ、ヘッダー、ロケールの変更が差分に影響する可能性があります。",
      deltas: "変更前後の差分は 2 つのローカル サンプルを比較したもので、通常の実行ごとのばらつきが含まれる場合があります。重要な測定は同じ条件で繰り返してください。"
    },
    accessibilityComparison: {
      urlChanged: "ユーザー補助のベースラインの作成後に、ページの URL が変更されました。",
      scopeChanged: "ユーザー補助の基準、セレクタ、または収集の上限が変更されました。この範囲で新しいベースラインを設定してください。",
      engineChanged: "ユーザー補助のエンジンが変更されました。検出結果を比較する前に、新しいベースラインを設定してください。",
      baselineTruncated: "ベースラインが切り詰められているため、新しい検出結果を安全に判断できません。",
      currentTruncated: "現在の監査が切り詰められているため、解決済みの検出結果を安全に判断できません。"
    },
    indexedDb: {
      origin: "対象はこのトップレベルのオリジンのみです。サードパーティのフレーム内のデータベースは含まれません。",
      snapshot: "データベースとレコードは特定の時点のスナップショットです。ウェブサイトが IndexedDB を変更したら更新してください。",
      names: "データベース、オブジェクト ストア、インデックス、キーの名前はウェブサイトが付けたもので、それ自体に個人データが含まれる場合があります。",
      longNames: "名前が 512 文字を超えるデータベースとオブジェクト ストアは除外されます。",
      valuesIncluded: "レコードのプレビューは範囲が限定されていますが、アプリケーションの個人データが含まれる場合があります。",
      valuesOmitted: "レコードの値は除外されます。",
      readOnly: "このインスペクタは IndexedDB を読み取るだけで、変更や消去は行いません。"
    },
    storageUsage: {
      estimates: "使用量と割り当ては特定の時点におけるブラウザの推定値であり、Chromium によるデータの削除や書き込みによって変わる場合があります。",
      quota: "割り当ては、Chromium がこのオリジンに対して現在報告している上限であり、デバイスの空き容量ではありません。",
      origin: "対象はこのトップレベルの HTTP(S) オリジンのみです。サードパーティのストレージやパーティション分割されたストレージは、別にカウントされる場合があります。",
      aggregates: "表示されるのは合計バイト数とブラウザのストレージの種類のみです。キー、値、ファイル名、レスポンス本文が含まれることはありません。",
      readOnly: "このインスペクタはストレージの使用量を読み取るだけで、データの変更や消去は行いません。",
      fallback: "Chromium の詳細な割り当ての内訳を利用できなかったため、このレポートではブラウザの全体的な推定値を使用しています：{reason}"
    },
    storageChanges: {
      baseline: "ベースラインはメモリ内にのみ保持され、クリアしたとき、タブのオリジンが変わったときや閉じたとき、または Hronaut を終了したときに破棄されます。",
      scope: "ローカル ストレージと Cookie はこのワークスペース内でオリジンごとに共有され、他のワークスペースからは分離されます。セッション ストレージはこのタブだけのものです。",
      valuesIncluded: "値はサイズの上限まで表示されます。HttpOnly Cookie の値は常に保護されます。",
      valuesOmitted: "値は含まれていません。",
      snapshot: "スナップショットには、ストレージの種類ごとに並べ替えた最初の 200 件のエントリが含まれます。ベースラインと比較の間に、ストレージがバックグラウンドで変わる可能性もあります。"
    },
    pwa: {
      origin: "対象はこのトップレベルのオリジンのみです。サードパーティのフレーム内のワーカーとキャッシュは含まれません。",
      snapshot: "登録とキャッシュされたエントリは、特定の時点のスナップショットです。ウェブサイトのオフライン状態が変わったら更新してください。",
      manifest: "マニフェストは範囲を限定したいくつかのフィールドとして読み込まれ、元のソースが表示されることはありません。",
      installabilityIds: "インストール可能性のエラー ID は Chromium から取得されるもので、Chromium のバージョンによって変わる場合があります。",
      readOnly: "このインスペクタはオフライン データを読み取るだけで、キャッシュされたレスポンス本文を表示することはありません。",
      headersIncluded: "リクエスト ヘッダーとレスポンス ヘッダーは上限まで表示されます。シークレットを含むと認識されたヘッダーは伏せられます。",
      headersOmitted: "ヘッダーの値は含まれていません。",
      opaqueSizes: "不透明なレスポンスのサイズにはブラウザの割り当てのパディングが含まれる場合があり、ここでは測定されません。",
      clearing: "このインスペクタがワーカーの登録を解除したり、キャッシュを消去したりすることはありません。",
      installabilityUnavailable: "インストール可能性の診断を利用できませんでした：{reason}"
    }
  },
  "ko-KR": {
    performance: {
      lcpPhases: "LCP 단계는 브라우저 타이밍 관찰 결과이며 인과관계를 증명하지 않습니다. 누락되거나 제한된 증거는 명시적으로 표시되며, 복원 및 소프트 탐색의 단계 분석은 지원되지 않습니다.",
      localSample: "현재 방문에서 얻은 로컬 샘플 1개이며, 필드 데이터나 CrUX 75번째 백분위수 결과가 아닙니다.",
      inpUnavailable: "INP는 페이지가 조건에 맞는 상호작용을 받기 전까지 사용할 수 없습니다. 백그라운드 방문이나 짧은 방문에서는 일부 측정항목을 사용할 수 없습니다.",
      longAnimationFrames: "긴 애니메이션 프레임 분석은 가장 느린 내부 함수가 아니라 스크립트 진입점을 식별합니다.",
      crossOrigin: "교차 출처 프레임, 워커, 서비스 워커, 격리된 환경의 코드는 스크립트 분석 없이 작업에 영향을 줄 수 있습니다.",
      userTimings: "User Timing 이름은 페이지에서 작성한 것이며 정리된 상태로 표시됩니다. 임의의 세부 객체, 스택 추적, 소스 코드는 생략됩니다.",
      layoutShifts: "레이아웃 변경 증거에서는 최근 개별 입력이 있었던 항목이 제외됩니다. 점수 합계는 진단용이며 CLS 세션 창 점수와 다를 수 있습니다.",
      baselineUrl: "기준 URL이 이 측정과 다릅니다. 탐색 변경이 의도한 것일 때만 비교하세요.",
      environment: "브라우저 환경이 기준과 다릅니다. 표시 영역, 제한, 캐시, 헤더 또는 언어 설정이 바뀌면 차이에 영향을 줄 수 있습니다.",
      deltas: "전후 차이는 로컬 샘플 2개를 비교한 것이며 실행마다 생기는 일반적인 편차가 포함될 수 있습니다. 중요한 측정은 같은 조건에서 반복하세요."
    },
    accessibilityComparison: {
      urlChanged: "접근성 기준을 설정한 후 페이지 URL이 변경되었습니다.",
      scopeChanged: "접근성 표준, 선택자 또는 수집 한도가 변경되었습니다. 이 범위에 대한 새 기준을 설정하세요.",
      engineChanged: "접근성 엔진이 변경되었습니다. 결과를 비교하기 전에 새 기준을 설정하세요.",
      baselineTruncated: "기준이 잘려 있어 새 결과를 안전하게 판단할 수 없습니다.",
      currentTruncated: "현재 감사가 잘려 있어 해결된 결과를 안전하게 판단할 수 없습니다."
    },
    indexedDb: {
      origin: "이 최상위 출처만 포함됩니다. 서드 파티 프레임의 데이터베이스는 포함되지 않습니다.",
      snapshot: "데이터베이스와 레코드는 특정 시점의 스냅샷입니다. 웹사이트가 IndexedDB를 변경하면 새로고침하세요.",
      names: "데이터베이스, 객체 저장소, 색인, 키 이름은 웹사이트에서 작성하며 그 자체에 개인 정보가 포함될 수 있습니다.",
      longNames: "이름이 512자보다 긴 데이터베이스와 객체 저장소는 제외됩니다.",
      valuesIncluded: "레코드 미리보기는 크기가 제한되며 애플리케이션의 개인 데이터가 포함될 수 있습니다.",
      valuesOmitted: "레코드 값은 제외됩니다.",
      readOnly: "이 검사 도구는 IndexedDB를 읽기만 하며 변경하거나 삭제하지 않습니다."
    },
    storageUsage: {
      estimates: "사용량과 할당량은 특정 시점의 브라우저 추정치이며 Chromium이 데이터를 제거하거나 쓰면 달라질 수 있습니다.",
      quota: "할당량은 Chromium이 현재 이 출처에 대해 보고하는 한도이며 기기의 여유 공간이 아닙니다.",
      origin: "이 최상위 HTTP(S) 출처만 포함됩니다. 서드 파티 저장소와 파티션된 저장소는 별도로 집계될 수 있습니다.",
      aggregates: "총 바이트 수와 브라우저의 저장소 카테고리만 표시됩니다. 키, 값, 파일 이름, 응답 본문은 포함되지 않습니다.",
      readOnly: "이 검사 도구는 저장소 사용량을 읽기만 하며 데이터를 변경하거나 삭제하지 않습니다.",
      fallback: "Chromium의 상세 할당량 내역을 사용할 수 없어 이 보고서는 브라우저의 전체 추정치를 사용합니다: {reason}"
    },
    storageChanges: {
      baseline: "기준은 메모리에만 보관되며, 기준을 지우거나 탭의 출처가 바뀌거나 탭이 닫히거나 Hronaut이 종료되면 삭제됩니다.",
      scope: "로컬 저장소와 쿠키는 이 작업 공간 안에서 출처별로 공유되며 다른 작업 공간과는 분리됩니다. 세션 저장소는 이 탭에만 속합니다.",
      valuesIncluded: "값은 크기 한도까지 표시됩니다. HttpOnly 쿠키 값은 항상 보호됩니다.",
      valuesOmitted: "값은 제외됩니다.",
      snapshot: "스냅샷에는 저장소 유형별로 정렬된 처음 200개 항목이 포함됩니다. 기준과 비교 사이에 저장소가 백그라운드에서 변경될 수도 있습니다."
    },
    pwa: {
      origin: "이 최상위 출처만 포함됩니다. 서드 파티 프레임의 워커와 캐시는 포함되지 않습니다.",
      snapshot: "등록과 캐시된 항목은 특정 시점의 스냅샷입니다. 웹사이트의 오프라인 상태가 바뀌면 새로고침하세요.",
      manifest: "매니페스트는 크기가 제한된 몇 가지 필드로만 읽으며 원본 소스는 표시하지 않습니다.",
      installabilityIds: "설치 가능성 오류 식별자는 Chromium에서 제공하며 Chromium 버전에 따라 달라질 수 있습니다.",
      readOnly: "이 검사 도구는 오프라인 데이터를 읽기만 하며 캐시된 응답 본문은 표시하지 않습니다.",
      headersIncluded: "요청 및 응답 헤더는 한도까지 표시됩니다. 비밀 정보가 담긴 것으로 확인된 헤더는 가려집니다.",
      headersOmitted: "헤더 값은 제외됩니다.",
      opaqueSizes: "불투명 응답의 크기에는 브라우저의 할당량 패딩이 포함될 수 있으며 여기에서는 측정하지 않습니다.",
      clearing: "이 검사 도구는 워커 등록을 해제하거나 캐시를 삭제하지 않습니다.",
      installabilityUnavailable: "설치 가능성 진단을 사용할 수 없습니다: {reason}"
    }
  },
  "zh-CN": {
    performance: {
      lcpPhases: "LCP 阶段是基于浏览器计时的观察结果，并非因果证明。缺失或受限的证据会明确标示；不支持恢复和软导航的阶段归因。",
      localSample: "这是本次访问的单个本地样本，并非实际用户数据，也不是 CrUX 第 75 百分位的结果。",
      inpUnavailable: "在页面收到符合条件的交互之前，INP 不可用；对于后台访问或短暂访问，部分指标不可用。",
      longAnimationFrames: "长动画帧归因识别的是脚本入口点，而不一定是内部最慢的函数。",
      crossOrigin: "跨源框架、Worker、Service Worker 和隔离环境中的代码可能会产生工作量，但没有脚本归因。",
      userTimings: "用户计时名称由页面编写并已脱敏；任意 detail 对象、堆栈轨迹和源代码都会被省略。",
      layoutShifts: "布局偏移证据不包括最近有离散输入的条目。其分数总和仅用于诊断，可能与 CLS 会话窗口评分不同。",
      baselineUrl: "基准网址与此次测量不同；仅当导航更改是有意为之时才进行比较。",
      environment: "浏览器环境与基准不同；视口、节流、缓存、标头或语言区域的更改都可能影响差异值。",
      deltas: "前后差异比较的是两个本地样本，可能包含正常的运行间波动；请在相同条件下重复进行重要的测量。"
    },
    accessibilityComparison: {
      urlChanged: "设置无障碍基准后页面网址已更改。",
      scopeChanged: "无障碍标准、选择器或收集限制已更改；请为此范围设置新的基准。",
      engineChanged: "无障碍引擎已更改；比较发现之前，请先设置新的基准。",
      baselineTruncated: "基准已被截断，因此无法安全地确定新的发现。",
      currentTruncated: "当前审核已被截断，因此无法安全地确定已解决的发现。"
    },
    indexedDb: {
      origin: "仅涵盖此顶层来源；不包括第三方框架中的数据库。",
      snapshot: "数据库和记录是某一时间点的快照。网站更改 IndexedDB 后，请刷新。",
      names: "数据库、对象存储、索引和键的名称由网站编写，其本身可能包含隐私数据。",
      longNames: "名称超过 512 个字符的数据库和对象存储会被省略。",
      valuesIncluded: "记录预览有长度限制，并且可能包含应用的隐私数据。",
      valuesOmitted: "记录值已被省略。",
      readOnly: "此检查器只会读取 IndexedDB，绝不会更改或清除它。"
    },
    storageUsage: {
      estimates: "用量和配额是浏览器在某一时间点的估算值，可能会随着 Chromium 逐出或写入数据而变化。",
      quota: "配额是 Chromium 当前为此来源报告的预算，而不是设备上的可用空间。",
      origin: "仅涵盖此顶层 HTTP(S) 来源；第三方存储和分区存储可能会单独计算。",
      aggregates: "仅显示字节总数和浏览器的存储类别。绝不包括键、值、文件名和响应正文。",
      readOnly: "此检查器只会读取存储用量，绝不会更改或清除数据。",
      fallback: "Chromium 的详细配额明细不可用，因此此报告使用浏览器的总体估算值：{reason}"
    },
    storageChanges: {
      baseline: "基准仅保存在内存中，在您清除它、标签页更改来源或关闭，或者 Hronaut 退出时会被舍弃。",
      scope: "本地存储和 Cookie 在此工作区内按来源共享，并与其他工作区隔离；会话存储仅属于此标签页。",
      valuesIncluded: "值会在大小限制内显示。HttpOnly Cookie 值始终受到保护。",
      valuesOmitted: "值已被省略。",
      snapshot: "快照涵盖每种存储类型排序后的前 200 个条目。在设置基准与比较之间，存储也可能在后台发生变化。"
    },
    pwa: {
      origin: "仅涵盖此顶层来源；不包括第三方框架中的 Worker 和缓存。",
      snapshot: "注册和缓存条目是某一时间点的快照。网站更改其离线状态后，请刷新。",
      manifest: "清单会被读取为少量有限的字段；绝不会显示其原始源代码。",
      installabilityIds: "可安装性错误标识符来自 Chromium，可能会因 Chromium 版本而异。",
      readOnly: "此检查器只会读取离线数据，绝不会显示缓存的响应正文。",
      headersIncluded: "请求标头和响应标头会在限制范围内显示；可识别的携带机密信息的标头会被隐去。",
      headersOmitted: "标头值已被省略。",
      opaqueSizes: "不透明响应的大小可能包含浏览器的配额填充，此处不进行测量。",
      clearing: "此检查器绝不会注销 Worker 或清除缓存。",
      installabilityUnavailable: "可安装性诊断不可用：{reason}"
    }
  },
  "zh-TW": {
    performance: {
      lcpPhases: "LCP 階段是瀏覽器計時的觀察結果，並非因果證明。缺少或受限的證據會明確標示；不支援還原與軟性導覽的階段歸因。",
      localSample: "這是目前造訪的單一本機樣本，並非實際使用者資料或 CrUX 第 75 百分位數結果。",
      inpUnavailable: "網頁收到符合條件的互動之前，無法取得 INP；在背景中或短暫的造訪，部分指標也無法取得。",
      longAnimationFrames: "長動畫影格歸因會找出指令碼的進入點，但不一定是內部最慢的函式。",
      crossOrigin: "跨來源框架、Worker、Service Worker 及隔離環境中的程式碼可能會產生工作負載，但沒有指令碼歸因。",
      userTimings: "User Timing 名稱由網頁自行撰寫並經過清理；任意的 detail 物件、堆疊追蹤和原始碼都會省略。",
      layoutShifts: "版面配置位移證據會排除最近有離散輸入的項目。其分數總和僅供診斷，可能與 CLS 工作階段視窗計分不同。",
      baselineUrl: "基準網址與這次測量不同；只有在刻意變更導覽時才進行比較。",
      environment: "瀏覽器環境與基準不同；檢視區、節流、快取、標頭或語言代碼的變更都可能影響差異值。",
      deltas: "前後差異值比較的是兩個本機樣本，可能包含每次執行之間的正常變動；重要的測量請在相同條件下重複進行。"
    },
    accessibilityComparison: {
      urlChanged: "建立無障礙基準後，網頁網址已變更。",
      scopeChanged: "無障礙標準、選取器或收集上限已變更；請為這個範圍設定新的基準。",
      engineChanged: "無障礙引擎已變更；比較檢查結果前，請先設定新的基準。",
      baselineTruncated: "基準已遭截斷，因此無法安全判斷新的檢查結果。",
      currentTruncated: "目前的稽核已遭截斷，因此無法安全判斷已解決的檢查結果。"
    },
    indexedDb: {
      origin: "僅涵蓋這個頂層來源；不包含第三方框架中的資料庫。",
      snapshot: "資料庫和記錄是某個時間點的快照。網站變更 IndexedDB 後，請重新整理。",
      names: "資料庫、物件存放區、索引和鍵的名稱由網站撰寫，本身就可能含有私人資料。",
      longNames: "名稱超過 512 個字元的資料庫和物件存放區會略去。",
      valuesIncluded: "記錄預覽有長度上限，可能含有私人的應用程式資料。",
      valuesOmitted: "已略去記錄值。",
      readOnly: "這個檢查器只會讀取 IndexedDB，絕不會變更或清除其中的資料。"
    },
    storageUsage: {
      estimates: "用量和配額是瀏覽器在某個時間點的估計值，可能會隨著 Chromium 清除或寫入資料而改變。",
      quota: "配額是 Chromium 目前為這個來源回報的預算，而不是裝置上的可用空間。",
      origin: "僅涵蓋這個頂層 HTTP(S) 來源；第三方和分區儲存空間可能會另外計算。",
      aggregates: "僅顯示位元組總數和瀏覽器的儲存空間類別，絕不會包含鍵、值、檔案名稱和回應內文。",
      readOnly: "這個檢查器只會讀取儲存空間用量，絕不會變更或清除資料。",
      fallback: "無法取得 Chromium 的詳細配額明細，因此這份報告使用瀏覽器的整體估計值：{reason}"
    },
    storageChanges: {
      baseline: "基準只會保留在記憶體中；當你清除基準、分頁變更來源或關閉，或 Hronaut 結束時，基準就會遭到捨棄。",
      scope: "本機儲存空間和 Cookie 在這個工作區內依來源共用，並與其他工作區隔離；工作階段儲存空間只屬於這個分頁。",
      valuesIncluded: "值會在大小上限內顯示。HttpOnly Cookie 的值一律受到保護。",
      valuesOmitted: "已略去值。",
      snapshot: "快照涵蓋每種儲存空間經排序後的前 200 個項目。在建立基準和進行比較之間，儲存空間也可能在背景中變更。"
    },
    pwa: {
      origin: "僅涵蓋這個頂層來源；不包含第三方框架中的 Worker 和快取。",
      snapshot: "註冊項目和快取項目是某個時間點的快照。網站變更離線狀態後，請重新整理。",
      manifest: "資訊清單只會讀入少數幾個有長度上限的欄位，絕不會顯示其原始內容。",
      installabilityIds: "可安裝性錯誤 ID 來自 Chromium，可能會因 Chromium 版本而異。",
      readOnly: "這個檢查器只會讀取離線資料，絕不會顯示快取的回應內文。",
      headersIncluded: "要求和回應標頭會在上限內顯示；已知會攜帶機密資訊的標頭會經過遮蓋。",
      headersOmitted: "已略去標頭值。",
      opaqueSizes: "不透明回應的大小可能包含瀏覽器的配額填補，這裡不會測量。",
      clearing: "這個檢查器絕不會取消註冊 Worker 或清除快取。",
      installabilityUnavailable: "無法取得可安裝性診斷資訊：{reason}"
    }
  },
}

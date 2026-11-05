export const deDEReportCaveats = {
  performance: {
    lcpPhases: 'LCP-Phasen sind Zeitbeobachtungen des Browsers, kein Ursachennachweis. Fehlende oder eingeschränkte Daten werden ausdrücklich ausgewiesen; Phasen nach einer Wiederherstellung oder Soft Navigation werden nicht zugeordnet.',
    localSample: 'Dies ist eine einzelne lokale Stichprobe des aktuellen Besuchs, keine Felddaten und kein CrUX-Ergebnis zum 75. Perzentil.',
    inpUnavailable: 'INP ist erst verfügbar, wenn die Seite eine geeignete Interaktion erhält; bei Besuchen im Hintergrund oder sehr kurzen Besuchen fehlen manche Messwerte.',
    longAnimationFrames: 'Die Zuordnung langer Animationsframes nennt die Einstiegspunkte von Skripten, nicht unbedingt die langsamste interne Funktion.',
    crossOrigin: 'Frames anderer Ursprünge, Worker, Service Worker und Code in isolierten Welten können Arbeit verursachen, die keinem Skript zugeordnet wird.',
    userTimings: 'Namen benutzerdefinierter Zeitmessungen stammen von der Seite und werden bereinigt; beliebige Detailobjekte, Stacktraces und Quellcode werden weggelassen.',
    layoutShifts: 'Layoutverschiebungen kurz nach einer Eingabe werden nicht berücksichtigt. Die Summe ihrer Werte dient der Diagnose und kann von der CLS-Bewertung nach Sitzungsfenstern abweichen.',
    baselineUrl: 'Die Adresse des Ausgangswerts unterscheidet sich von dieser Messung; vergleichen Sie nur, wenn die Navigation beabsichtigt war.',
    environment: 'Die Browserumgebung unterscheidet sich vom Ausgangswert; Änderungen an Ansichtsbereich, Drosselung, Cache, Headern oder Sprache können die Differenz beeinflussen.',
    deltas: 'Vorher-nachher-Differenzen vergleichen zwei lokale Stichproben und können normale Schwankungen zwischen Läufen enthalten; wiederholen Sie wichtige Messungen unter gleichen Bedingungen.'
  },
  accessibilityComparison: {
    urlChanged: 'Die Seitenadresse hat sich seit der Baseline geändert.',
    scopeChanged: 'Standard, Selektor oder Erfassungsgrenzen der Prüfung haben sich geändert; legen Sie für diesen Umfang eine neue Baseline fest.',
    engineChanged: 'Die Prüf-Engine hat sich geändert; legen Sie vor dem Vergleich eine neue Baseline fest.',
    baselineTruncated: 'Die Baseline wurde gekürzt, daher lassen sich neue Befunde nicht sicher bestimmen.',
    currentTruncated: 'Die aktuelle Prüfung wurde gekürzt, daher lassen sich behobene Befunde nicht sicher bestimmen.'
  },
  indexedDb: {
    origin: 'Nur dieser Top-Level-Ursprung wird erfasst; Datenbanken in Frames von Drittanbietern sind nicht enthalten.',
    snapshot: 'Datenbanken und Datensätze sind eine Momentaufnahme. Aktualisieren Sie, nachdem die Website IndexedDB geändert hat.',
    names: 'Namen von Datenbanken, Objektspeichern, Indizes und Schlüsseln stammen von der Website und können selbst private Daten enthalten.',
    longNames: 'Datenbanken und Objektspeicher mit Namen über 512 Zeichen werden ausgelassen.',
    valuesIncluded: 'Vorschauen der Datensätze sind begrenzt und können private Anwendungsdaten enthalten.',
    valuesOmitted: 'Werte der Datensätze werden ausgelassen.',
    readOnly: 'Diese Ansicht liest IndexedDB nur und ändert oder löscht nichts.'
  },
  storageUsage: {
    estimates: 'Nutzung und Kontingent sind Momentaufnahmen, die der Browser schätzt, und können sich ändern, wenn Chromium Daten entfernt oder schreibt.',
    quota: 'Das Kontingent ist das Budget, das Chromium derzeit für diesen Ursprung meldet, nicht der freie Speicherplatz des Geräts.',
    origin: 'Nur dieser Top-Level-HTTP(S)-Ursprung wird erfasst; Speicher von Drittanbietern und partitionierter Speicher können getrennt gezählt werden.',
    aggregates: 'Angezeigt werden nur Gesamtgrößen in Bytes und die Speicherkategorien des Browsers. Schlüssel, Werte, Dateinamen und Antworttexte sind nie enthalten.',
    readOnly: 'Diese Ansicht liest die Speichernutzung nur und ändert oder löscht keine Daten.',
    fallback: 'Die detaillierte Kontingentaufschlüsselung von Chromium war nicht verfügbar, daher verwendet dieser Bericht die Gesamtschätzung des Browsers: {reason}'
  },
  storageChanges: {
    baseline: 'Der Ausgangszustand bleibt nur im Speicher und wird verworfen, wenn Sie ihn löschen, wenn der Tab den Ursprung wechselt oder geschlossen wird oder wenn Hronaut beendet wird.',
    scope: 'Lokaler Speicher und Cookies werden pro Ursprung innerhalb dieses Arbeitsbereichs geteilt und von anderen Arbeitsbereichen getrennt; der Sitzungsspeicher gehört nur zu diesem Tab.',
    valuesIncluded: 'Werte werden bis zu einer Größengrenze angezeigt. Werte von HttpOnly-Cookies bleiben immer geschützt.',
    valuesOmitted: 'Werte werden ausgelassen.',
    snapshot: 'Der Schnappschuss umfasst die ersten 200 sortierten Einträge je Speicherart. Der Speicher kann sich zwischen Ausgangszustand und Vergleich auch im Hintergrund ändern.'
  },
  pwa: {
    origin: 'Nur dieser Top-Level-Ursprung wird erfasst; Worker und Caches in Frames von Drittanbietern sind nicht enthalten.',
    snapshot: 'Registrierungen und zwischengespeicherte Einträge sind eine Momentaufnahme. Aktualisieren Sie, nachdem die Website ihren Offline-Zustand geändert hat.',
    manifest: 'Das Manifest wird in wenige begrenzte Felder gelesen; sein Quelltext wird nie angezeigt.',
    installabilityIds: 'Die Kennungen von Installierbarkeitsfehlern stammen von Chromium und können sich zwischen Chromium-Versionen ändern.',
    readOnly: 'Diese Ansicht liest Offline-Daten nur und zeigt nie zwischengespeicherte Antworttexte.',
    headersIncluded: 'Anfrage- und Antwort-Header werden bis zu einer Grenze angezeigt; erkannte Header mit Geheimnissen werden geschwärzt.',
    headersOmitted: 'Header-Werte werden ausgelassen.',
    opaqueSizes: 'Größen opaker Antworten können das Kontingent-Padding des Browsers enthalten und werden hier nicht gemessen.',
    clearing: 'Diese Ansicht meldet nie Worker ab und leert nie Caches.',
    installabilityUnavailable: 'Installierbarkeitsdiagnosen waren nicht verfügbar: {reason}'
  }
}

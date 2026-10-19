import type { AppErrorMessages } from './en-US.js'

export const deDEAppErrors: AppErrorMessages = {
  "startup": {
    "initializing": "Gespeicherte Arbeitsbereiche werden noch geladen. Versuchen Sie es nach dem Start erneut.",
    "unavailable": "Gespeicherte Arbeitsbereiche sind nicht verfügbar.",
    "readUnavailable": "Der Arbeitsbereich kann nicht mehr gelesen werden.",
    "tooManyReads": "Zu viele Lesevorgänge für Arbeitsbereiche stehen aus.",
    "metadataUnavailable": "Die Metadaten der gespeicherten Arbeitsbereiche sind nicht verfügbar ({reason}). Der Start wurde angehalten, damit eine Wiederherstellung möglich bleibt."
  },
  "sleep": {
    "onlyWebsites": "Nur inaktive Website-Tabs können in den Ruhezustand wechseln.",
    "visible": "Ein sichtbarer Tab kann nicht in den Ruhezustand wechseln.",
    "pinned": "Angeheftete Tabs bleiben aktiv.",
    "pageHold": "Ein Tab, dessen Seite ausdrücklich gehalten wird, bleibt aktiv.",
    "loading": "Ein Tab, der noch lädt, kann nicht in den Ruhezustand wechseln.",
    "audio": "Ein Tab, der Audio abspielt, bleibt aktiv.",
    "dialog": "Ein Tab mit einem offenen Dialog bleibt aktiv.",
    "wallet": "Ein Tab, der auf eine Wallet-Anfrage wartet, bleibt aktiv.",
    "devTools": "Ein Tab mit geöffneten Entwicklertools bleibt aktiv.",
    "interaction": "Ein Tab mit einer laufenden Interaktion bleibt aktiv.",
    "video": "Ein Tab, der Video aufnimmt, bleibt aktiv.",
    "repro": "Ein Tab, der Reproduktionsschritte aufzeichnet, bleibt aktiv.",
    "domChanges": "Ein Tab, der DOM-Änderungen aufzeichnet, bleibt aktiv.",
    "liveRegion": "Ein Tab, der eine Live-Region aufzeichnet, bleibt aktiv.",
    "cssState": "Ein Tab mit einem erzwungenen CSS-Zustand bleibt aktiv.",
    "domMutationSource": "Ein Tab, der die Quelle einer DOM-Änderung erfasst, bleibt aktiv.",
    "passkey": "Ein Tab mit einem virtuellen Passkey bleibt aktiv.",
    "logpoints": "Ein Tab mit aktiven Logpoints bleibt aktiv.",
    "coverage": "Ein Tab, der Code-Abdeckung aufzeichnet, bleibt aktiv.",
    "cpuProfile": "Ein Tab, der ein JavaScript-CPU-Profil aufzeichnet, bleibt aktiv.",
    "memory": "Ein Tab, der Speicherzuweisungen aufzeichnet, bleibt aktiv.",
    "mcpCommand": "Ein Tab mit einem laufenden MCP-Befehl bleibt aktiv.",
    "download": "Ein Tab mit einem laufenden Download bleibt aktiv.",
    "render": "Ein Tab, der eine Seitenaufnahme oder ein PDF erstellt, bleibt aktiv.",
    "unsavedForm": "Dieser Tab enthält ein teilweise ausgefülltes Formular und bleibt aktiv, damit nicht gespeicherte Eingaben erhalten bleiben."
  },
  "splitView": {
    "sameTab": "Wählen Sie einen anderen Tab für die geteilte Ansicht.",
    "home": "Die Hronaut-Startseite kann nicht in der geteilten Ansicht geöffnet werden.",
    "currentUnavailable": "Der aktuelle Tab funktioniert nicht mehr. Schließen Sie ihn und öffnen Sie ihn unter „Kürzlich geschlossen“ erneut.",
    "selectedUnavailable": "Der ausgewählte Tab funktioniert nicht mehr. Schließen Sie ihn und öffnen Sie ihn unter „Kürzlich geschlossen“ erneut.",
    "notOpen": "Die geteilte Ansicht ist nicht geöffnet."
  },
  "clipboard": {
    "textTooLarge": "Der Text ist zu groß, um ihn sicher zu kopieren (höchstens 8 MB).",
    "textRejected": "Der Text wurde vorbereitet, aber die Zwischenablage des Systems hat ihn nicht angenommen.",
    "screenshotRejected": "Der Screenshot wurde aufgenommen, aber die Zwischenablage des Systems hat das Bild nicht angenommen.",
    "pageClosed": "Die Seite wurde geschlossen, bevor ihr Bild kopiert werden konnte.",
    "imageRejected": "Das Bild auf der Seite wurde ausgewählt, aber die Zwischenablage des Systems hat es nicht angenommen."
  },
  "tabs": {
    "noActiveTab": "Es gibt keinen aktiven Tab.",
    "rendererUnavailable": "Dieser Tab reagiert nicht mehr. Schließen Sie ihn und öffnen Sie ihn unter „Kürzlich geschlossen“ erneut.",
    "limit": "Tab-Limit erreicht ({max}).",
    "homeNotPinned": "Die Hronaut-Startseite kann nicht angeheftet werden.",
    "homeNotReordered": "Die Hronaut-Startseite kann nicht verschoben werden.",
    "pinnedBoundary": "Heften Sie den Tab an oder lösen Sie ihn, bevor Sie ihn zwischen angehefteten und normalen Tabs verschieben.",
    "otherWorkspace": "Tabs können nur innerhalb desselben Arbeitsbereichs neu angeordnet werden.",
    "homeNotDuplicated": "Die Hronaut-Startseite kann nicht dupliziert werden.",
    "homeInAgentWorkspace": "Die Hronaut-Startseite ist eine Anwendungsseite für Menschen und kann keinem Agenten-Arbeitsbereich hinzugefügt werden.",
    "workspaceCleanupFailed": "Der neue Tab konnte nicht geöffnet werden, und sein Arbeitsbereich konnte nicht aufgeräumt werden. Der Arbeitsbereich bleibt für die Wiederherstellung verfügbar."
  },
  "page": {
    "rendererExitedDuringAction": "Die Seite wurde während dieser Aktion angehalten, weil ihr Prozess beendet wurde; die Auswirkungen sind unbekannt. Laden Sie den Tab neu oder schließen Sie ihn, und prüfen Sie dann seinen aktuellen Zustand.",
    "rendererExitedBeforeAction": "Die Seite läuft nicht, weil ihr Prozess beendet wurde; es wurde nichts an sie gesendet. Laden Sie den Tab neu oder schließen Sie ihn, und prüfen Sie dann seinen aktuellen Zustand.",
    "closedWhileWaiting": "Der Tab wurde geschlossen, während auf die Seite gewartet wurde.",
    "rendererLostWhileWaiting": "Der Tab reagierte nicht mehr, während auf die Seite gewartet wurde.",
    "loadTimedOut": "Zeitüberschreitung beim Warten auf das Laden der Seite.",
    "zoomPercent": "Der Seitenzoom muss eine ganze Zahl zwischen 50 und 400 Prozent sein.",
    "findQuery": "Der Suchbegriff muss zwischen 1 und 1.000 Zeichen lang sein."
  },
  "loadFailure": {
    "nameNotResolved": "Die Website-Adresse konnte nicht gefunden werden ({code}).",
    "connectionRefused": "Die Website hat die Verbindung abgelehnt ({code}).",
    "offline": "Das Gerät scheint offline zu sein ({code}).",
    "timedOut": "Die Antwort der Website hat zu lange gedauert ({code}).",
    "connectionReset": "Die Verbindung wurde beim Laden der Seite zurückgesetzt ({code}).",
    "certificate": "Hronaut vertraut dem Sicherheitszertifikat dieser Website nicht ({code})."
  },
  "navigation": {
    "homeInAgentWorkspace": "Die Hronaut-Startseite ist eine Anwendungsseite für Menschen und kann nicht in einem Agenten-Arbeitsbereich geöffnet werden.",
    "agentSchemes": "In Agenten-Arbeitsbereichen können keine lokalen, privilegierten oder Anmeldedaten enthaltenden Browseradressen geöffnet werden.",
    "originBlocked": "Die Navigation zu {origin} ist in diesem Arbeitsbereich gesperrt. Erlauben Sie diesen Ursprung in den Einstellungen „Website-Zugriff“ des vertrauenswürdigen Arbeitsbereichs.",
    "observerOrigin": "Der Ursprung eines öffentlichen Beobachters kann nicht geändert oder erweitert werden.",
    "recoveryRunning": "Der Tab wird bereits wiederhergestellt.",
    "recoveryPageChanged": "Die Seite hat sich während der Wiederherstellung des Tabs geändert.",
    "recoveryTabClosed": "Der Tab wurde während der Wiederherstellung geschlossen.",
    "recoveryTimedOut": "Der Tab konnte nicht rechtzeitig wiederhergestellt werden."
  },
  "workspace": {
    "unavailable": "Der Arbeitsbereich ist nicht mehr verfügbar.",
    "busyArchiving": "Der Arbeitsbereich „{name}“ wird gerade archiviert. Versuchen Sie es erneut, sobald der Vorgang abgeschlossen ist.",
    "busyClosing": "Der Arbeitsbereich „{name}“ wird gerade geschlossen. Versuchen Sie es erneut, sobald der Vorgang abgeschlossen ist.",
    "busyForking": "Vom Arbeitsbereich „{name}“ wird gerade eine Kopie erstellt. Versuchen Sie es erneut, sobald der Vorgang abgeschlossen ist.",
    "busyRestoring": "Der Arbeitsbereich „{name}“ wird gerade aus dem Archiv wiederhergestellt. Versuchen Sie es erneut, sobald der Vorgang abgeschlossen ist.",
    "busyClearingData": "Im Arbeitsbereich „{name}“ werden gerade Websitedaten gelöscht. Versuchen Sie es erneut, sobald der Vorgang abgeschlossen ist.",
    "busyMovingData": "Die Daten des Arbeitsbereichs „{name}“ werden gerade verschoben. Versuchen Sie es erneut, sobald der Vorgang abgeschlossen ist.",
    "busyCopyingData": "Die Daten des Arbeitsbereichs „{name}“ werden gerade kopiert. Versuchen Sie es erneut, sobald der Vorgang abgeschlossen ist.",
    "busyImportingCookies": "In den Arbeitsbereich „{name}“ werden gerade Browser-Cookies importiert. Versuchen Sie es erneut, sobald der Vorgang abgeschlossen ist."
  },
  "lifecycle": {
    "homeTab": "Nur Tabs mit laufenden Seiten können eingefroren oder fortgesetzt werden.",
    "sleeping": "Wecken Sie den ruhenden Tab auf, bevor Sie den Zustand seiner Seite ändern.",
    "rendererUnavailable": "Der Tab reagiert gerade nicht.",
    "closedWhileChanging": "Der Tab wurde geschlossen, während der Zustand seiner Seite geändert wurde.",
    "closedBeforeDispatch": "Der Tab wurde geschlossen, bevor der Befehl zum Ändern des Seitenzustands gesendet wurde.",
    "documentChanged": "Die Seite hat sich geändert, bevor der Befehl zum Ändern ihres Zustands gesendet wurde.",
    "devTools": "Schließen Sie die Entwicklertools für diesen Tab, bevor Sie den Zustand seiner Seite ändern."
  },
  "inputLock": {
    "pageBusy": "Eine Seite ist beschäftigt. Die Eingabesperren wurden nicht geändert. Warten Sie, bis ihr Vorgang abgeschlossen ist, und versuchen Sie es dann erneut.",
    "observer": "Im schreibgeschützten Arbeitsbereich eines öffentlichen Beobachters bleibt die Eingabe auf der Seite gesperrt.",
    "tabClosed": "Der Tab wurde geschlossen, bevor seine Eingabesperre geändert wurde.",
    "tabNotRestored": "Die Eingabesperre dieses Tabs konnte weder geändert noch wiederhergestellt werden.",
    "allNotRestored": "Die globale Eingabesperre konnte nicht für jeden Tab geändert oder wiederhergestellt werden.",
    "allNotUpdated": "Die globale Eingabesperre konnte nicht für jeden Tab geändert werden."
  },
  "agentPause": {
    "serviceUnavailable": "Der Agentendienst ist nicht verfügbar."
  },
  "devTools": {
    "targetChanged": "Der Tab hat sich geändert, bevor die Entwicklertools geöffnet wurden.",
    "conditionsPending": "Anfragebedingungen werden noch angewendet. Warten Sie, bis dies abgeschlossen ist, bevor Sie die Entwicklertools öffnen.",
    "conditionsChanged": "Die Anfragebedingungen haben sich geändert, bevor die Entwicklertools geöffnet wurden."
  },
  "bookmarks": {
    "invalidUrl": "Die Lesezeichenadresse muss eine HTTP- oder HTTPS-Adresse mit höchstens 4.096 codierten Zeichen sein.",
    "limit": "Lesezeichenlimit erreicht ({max}).",
    "duplicate": "Diese Adresse ist bereits als Lesezeichen gespeichert.",
    "unavailable": "Das Lesezeichen ist nicht mehr verfügbar.",
    "collectionLimit": "Sammlungslimit erreicht (50).",
    "collectionMissing": "Die Lesezeichensammlung wurde nicht gefunden.",
    "collectionNameTaken": "Eine Lesezeichensammlung mit diesem Namen existiert bereits.",
    "collectionName": "Der Sammlungsname muss 1 bis 80 Zeichen enthalten.",
    "storageUnavailable": "Der Lesezeichenspeicher ist nicht verfügbar.",
    "historyUnavailable": "Der Besuchsverlauf ist nicht verfügbar."
  },
  "startupScreen": {
    "title": "Hronaut konnte nicht starten",
    "description": "Die Anwendungsoberfläche konnte ihre anfänglichen Einstellungen nicht laden.",
    "retry": "Erneut versuchen",
    "privacy": "Ihr Browserprofil bleibt auf diesem Gerät.",
    "settingsUnavailable": "Der Einstellungsdienst der Oberfläche ist nicht verfügbar."
  }
}

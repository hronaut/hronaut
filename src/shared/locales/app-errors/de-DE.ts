import type { AppErrorMessages } from './en-US.js'

export const deDEAppErrors: AppErrorMessages = {
  "startup": {
    "initializing": "Gespeicherte Arbeitsbereiche werden noch geladen. Versuchen Sie es nach dem Start erneut.",
    "unavailable": "Gespeicherte Arbeitsbereiche sind nicht verfügbar.",
    "readUnavailable": "Der Arbeitsbereich kann nicht mehr gelesen werden.",
    "tooManyReads": "Zu viele Lesevorgänge für Arbeitsbereiche stehen aus."
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
  "startupScreen": {
    "title": "Hronaut konnte nicht starten",
    "description": "Die Anwendungsoberfläche konnte ihre anfänglichen Einstellungen nicht laden.",
    "retry": "Erneut versuchen",
    "privacy": "Ihr Browserprofil bleibt auf diesem Gerät.",
    "settingsUnavailable": "Der Einstellungsdienst der Oberfläche ist nicht verfügbar."
  }
}

export const deDETrustedDialogs = {
  close: 'Schließen',
  httpAuth: {
    eyebrow: 'Anmelden',
    headline: 'Bei {origin} anmelden',
    notPrivate: 'Ihre Verbindung zu dieser Website ist nicht privat. Jeder im Netzwerk kann Ihren Benutzernamen und Ihr Passwort lesen.',
    workspace: 'Sie bleiben auf dieser Website im Arbeitsbereich „{workspace}“ angemeldet, bis Hronaut beendet wird.',
    sent: 'Hronaut sendet Ihren Benutzernamen und Ihr Passwort nur an diese Website und zeigt sie Agenten nie.',
    username: 'Benutzername',
    password: 'Passwort',
    signIn: 'Anmelden'
  },
  certificate: {
    eyebrow: 'Nicht sicher',
    headline: 'Weiter zu {host}?',
    authority: 'Das Sicherheitszertifikat stammt nicht von einer Stelle, der dieser Computer vertraut.',
    name: 'Das Sicherheitszertifikat gilt für eine andere Website.',
    date: 'Das Sicherheitszertifikat ist abgelaufen oder noch nicht gültig.',
    other: 'Das Sicherheitszertifikat lässt sich nicht überprüfen.',
    risk: 'Jemand im Netzwerk könnte sich als diese Website ausgeben, um mitzulesen, was Sie ihr senden, etwa Passwörter.',
    workspace: 'Hronaut vertraut diesem Zertifikat für diese Website im Arbeitsbereich „{workspace}“, bis Hronaut beendet wird, und auch die Agenten im Arbeitsbereich können sie öffnen.',
    session: 'Hronaut vertraut diesem Zertifikat für diese Website, bis Hronaut beendet wird.',
    back: 'Zurück zu sicherer Seite',
    proceed: 'Weiter (unsicher)'
  },
  savePassword: {
    eyebrow: 'Gespeicherte Passwörter',
    save: 'Passwort für {origin} speichern?',
    update: 'Gespeichertes Passwort für {origin} aktualisieren?',
    username: 'Benutzername',
    noUsername: 'Die Seite hat keinen Benutzernamen mitgesendet.',
    stored: 'Hronaut verschlüsselt es mit dem sicheren Speicher des Betriebssystems. Gespeicherte Passwörter werden niemals über MCP offengelegt.'
  },
  walletRecovery: {
    eyebrow: 'Neue Wallet',
    headline: 'Notieren Sie die Wiederherstellungsphrase für {wallet}',
    phrase: 'Wiederherstellungsphrase',
    keep: 'Schreiben Sie diese Wörter in dieser Reihenfolge auf und bewahren Sie sie offline auf. Wer sie kennt, kontrolliert die Wallet.',
    added: 'Hronaut fügt die Wallet hinzu, sobald Sie bestätigen, dass Sie die Wörter gesichert haben.'
  },
  claudeSetup: {
    file: 'Datei',
    added: 'Neuer Eintrag in "mcpServers"',
    replaces: 'Eintrag, den er ersetzt'
  },
  sitePermission: {
    embeddedIn: 'Eingebettet in {site}',
    wants: {
      camera: '{origin} möchte Ihre Kamera verwenden',
      microphone: '{origin} möchte Ihr Mikrofon verwenden',
      cameraAndMicrophone: '{origin} möchte Ihre Kamera und Ihr Mikrofon verwenden',
      geolocation: '{origin} möchte Ihren Standort erfahren',
      notifications: '{origin} möchte Benachrichtigungen anzeigen',
      clipboardRead: '{origin} möchte Text und Bilder sehen, die Sie kopieren',
      midiSysex: '{origin} möchte Ihre MIDI-Geräte steuern und neu programmieren',
      midi: '{origin} möchte Ihre MIDI-Geräte verwenden',
      localFonts: '{origin} möchte die Schriftarten auf Ihrem Computer verwenden',
      localNetwork: '{origin} möchte Geräte in Ihrem lokalen Netzwerk finden und sich mit ihnen verbinden',
      loopbackNetwork: '{origin} möchte sich mit Apps und Diensten auf diesem Gerät verbinden',
      fileSystem: '{origin} möchte eine Datei oder einen Ordner auf Ihrem Computer verwenden',
      openExternal: '{origin} möchte eine App auf Ihrem Computer öffnen',
      idleDetection: '{origin} möchte wissen, wann Sie dieses Gerät verwenden',
      keyboardLock: '{origin} möchte Ihre Tastenkombinationen abfangen',
      pointerLock: '{origin} möchte Ihren Mauszeiger sperren und ausblenden',
      windowManagement: '{origin} möchte Fenster auf all Ihren Bildschirmen verwalten',
      displayCapture: '{origin} möchte Ihren Bildschirm sehen',
      other: '{origin} möchte „{permission}“ verwenden'
    }
  }
}

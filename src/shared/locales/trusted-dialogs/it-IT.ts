export const itITTrustedDialogs = {
  close: 'Chiudi',
  httpAuth: {
    eyebrow: 'Accedi',
    headline: 'Accedi a {origin}',
    notPrivate: 'La connessione a questo sito non è privata. Chiunque sulla rete può leggere il tuo nome utente e la tua password.',
    workspace: 'Resti connesso a questo sito web nell’area di lavoro “{workspace}” finché Hronaut non viene chiuso.',
    sent: 'Hronaut invia il tuo nome utente e la tua password solo a questo sito web e non li mostra mai agli agenti.',
    username: 'Nome utente',
    password: 'Password',
    signIn: 'Accedi'
  },
  certificate: {
    eyebrow: 'Connessione non privata',
    headline: 'Procedere su {host}?',
    authority: 'Il suo certificato di sicurezza non proviene da un’autorità considerata attendibile da questo computer.',
    name: 'Il suo certificato di sicurezza è di un altro sito web.',
    date: 'Il suo certificato di sicurezza è scaduto o non è ancora valido.',
    other: 'Il suo certificato di sicurezza non può essere verificato.',
    risk: 'Qualcuno sulla rete potrebbe fingersi questo sito web per leggere ciò che gli invii, come le password.',
    workspace: 'Hronaut considera attendibile questo certificato per questo sito web nell’area di lavoro “{workspace}” finché Hronaut non viene chiuso, e anche gli agenti dell’area di lavoro possono aprirlo.',
    session: 'Hronaut considera attendibile questo certificato per questo sito web finché Hronaut non viene chiuso.',
    back: 'Torna al sicuro',
    proceed: 'Procedi (non sicuro)'
  },
  savePassword: {
    eyebrow: 'Password salvate',
    save: 'Vuoi salvare la password per {origin}?',
    update: 'Vuoi aggiornare la password salvata per {origin}?',
    username: 'Nome utente',
    noUsername: 'La pagina non ha inviato alcun nome utente.',
    stored: 'Hronaut la crittografa con l’archivio sicuro del sistema operativo. Le password salvate non vengono mai esposte tramite MCP.'
  },
  walletRecovery: {
    eyebrow: 'Nuovo wallet',
    headline: 'Annota la frase di recupero per {wallet}',
    phrase: 'Frase di recupero',
    keep: 'Annota queste parole nell’ordine indicato e conservale offline. Chiunque le possieda controlla il wallet.',
    added: 'Hronaut aggiunge il wallet dopo che hai confermato di averle salvate.'
  },
  claudeSetup: {
    file: 'File',
    added: 'Nuova voce in "mcpServers"',
    replaces: 'Voce che sostituisce'
  },
  sitePermission: {
    embeddedIn: 'Incorporato in {site}',
    wants: {
      camera: '{origin} vuole usare la fotocamera',
      microphone: '{origin} vuole usare il microfono',
      cameraAndMicrophone: '{origin} vuole usare la fotocamera e il microfono',
      geolocation: '{origin} vuole conoscere la tua posizione',
      notifications: '{origin} vuole mostrare notifiche',
      clipboardRead: '{origin} vuole vedere il testo e le immagini che copi',
      clipboardWrite: '{origin} vuole copiare testo e immagini negli appunti',
      midiSysex: '{origin} vuole controllare e riprogrammare i tuoi dispositivi MIDI',
      midi: '{origin} vuole usare i tuoi dispositivi MIDI',
      localFonts: '{origin} vuole usare i font installati sul tuo computer',
      localNetwork: '{origin} vuole cercare i dispositivi della tua rete locale e connettersi a essi',
      loopbackNetwork: '{origin} vuole connettersi ad app e servizi su questo dispositivo',
      fileSystem: '{origin} vuole usare un file o una cartella sul tuo computer',
      openExternal: '{origin} vuole aprire un’app sul tuo computer',
      fullscreen: '{origin} vuole usare lo schermo intero',
      idleDetection: '{origin} vuole sapere quando stai usando questo dispositivo',
      keyboardLock: '{origin} vuole acquisire le tue scorciatoie da tastiera',
      pointerLock: '{origin} vuole bloccare e nascondere il puntatore del mouse',
      persistentStorage: '{origin} vuole archiviare dati in modo permanente su questo dispositivo',
      screenWakeLock: '{origin} vuole mantenere lo schermo acceso',
      storageAccess: '{origin} vuole usare i propri cookie e dati dei siti in questa pagina',
      topLevelStorageAccess: '{origin} vuole usare cookie e dati dei siti di siti web correlati',
      windowManagement: '{origin} vuole gestire le finestre su tutti i tuoi schermi',
      displayCapture: '{origin} vuole vedere il tuo schermo',
      other: '{origin} vuole usare “{permission}”'
    }
  }
}

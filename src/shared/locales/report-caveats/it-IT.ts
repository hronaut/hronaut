export const itITReportCaveats = {
  performance: {
    lcpPhases: 'Le fasi LCP sono osservazioni dei tempi del browser, non prove di causalità. Le prove mancanti o limitate vengono indicate esplicitamente; l’attribuzione delle fasi per ripristini e navigazioni soft non è supportata.',
    localSample: 'Questo è un singolo campione locale della visita attuale, non dati sul campo né un risultato CrUX al 75° percentile.',
    inpUnavailable: 'L’INP non è disponibile finché la pagina non riceve un’interazione idonea; alcune metriche non sono disponibili per visite in background o di breve durata.',
    longAnimationFrames: 'L’attribuzione dei frame di animazione lunghi identifica i punti di ingresso degli script, non necessariamente la funzione interna più lenta.',
    crossOrigin: 'Frame multiorigine, worker, service worker e codice in mondi isolati possono contribuire al lavoro senza attribuzione agli script.',
    userTimings: 'I nomi User Timing sono definiti dalla pagina e ripuliti; oggetti di dettaglio arbitrari, stack trace e codice sorgente vengono omessi.',
    layoutShifts: 'Le prove sugli spostamenti del layout escludono le voci con input discreti recenti. La somma dei punteggi è diagnostica e può differire dal punteggio CLS per finestra di sessione.',
    baselineUrl: 'L’URL di riferimento è diverso da quello di questa misurazione; confrontali solo se la modifica alla navigazione era intenzionale.',
    environment: 'L’ambiente del browser è diverso da quello di riferimento; modifiche ad area visibile, limitazione, cache, intestazioni o impostazioni internazionali possono influire sulla differenza.',
    deltas: 'Le differenze prima/dopo confrontano due campioni locali e possono includere la normale variazione tra un’esecuzione e l’altra; ripeti le misurazioni importanti in condizioni equivalenti.'
  },
  accessibilityComparison: {
    urlChanged: 'L’URL della pagina è cambiato dopo il riferimento di accessibilità.',
    scopeChanged: 'Lo standard di accessibilità, il selettore o i limiti di raccolta sono cambiati; imposta un nuovo riferimento per questo ambito.',
    engineChanged: 'Il motore di accessibilità è cambiato; imposta un nuovo riferimento prima di confrontare i risultati.',
    baselineTruncated: 'Il riferimento è stato troncato, quindi non è possibile determinare in modo sicuro i nuovi risultati.',
    currentTruncated: 'Il controllo attuale è stato troncato, quindi non è possibile determinare in modo sicuro i risultati risolti.'
  },
  indexedDb: {
    origin: 'È coperta solo questa origine di primo livello; i database nei frame di terze parti non sono inclusi.',
    snapshot: 'Database e record sono uno snapshot di un preciso momento. Aggiorna dopo che il sito web ha modificato IndexedDB.',
    names: 'I nomi di database, archivi di oggetti, indici e chiavi sono scritti dal sito web e possono contenere essi stessi dati privati.',
    longNames: 'I database e gli archivi di oggetti con nomi più lunghi di 512 caratteri vengono esclusi.',
    valuesIncluded: 'Le anteprime dei record sono limitate e possono contenere dati privati dell’applicazione.',
    valuesOmitted: 'I valori dei record vengono esclusi.',
    readOnly: 'Questo strumento di ispezione legge soltanto IndexedDB e non lo modifica né lo cancella mai.'
  },
  storageUsage: {
    estimates: 'Utilizzo e quota sono stime del browser relative a un preciso momento e possono cambiare quando Chromium rimuove o scrive dati.',
    quota: 'La quota è il budget che Chromium indica attualmente per questa origine, non lo spazio libero sul dispositivo.',
    origin: 'È coperta solo questa origine HTTP(S) di primo livello; l’archiviazione di terze parti e partizionata può essere conteggiata separatamente.',
    aggregates: 'Vengono mostrati solo i conteggi totali dei byte e le categorie di archiviazione del browser. Chiavi, valori, nomi di file e corpi delle risposte non sono mai inclusi.',
    readOnly: 'Questo strumento di ispezione legge soltanto l’utilizzo dello spazio di archiviazione e non modifica né cancella mai i dati.',
    fallback: 'La ripartizione dettagliata della quota di Chromium non era disponibile, quindi questo report usa la stima complessiva del browser: {reason}'
  },
  storageChanges: {
    baseline: 'Il riferimento resta solo in memoria e viene eliminato quando lo cancelli, quando la scheda cambia origine o viene chiusa, oppure quando esci da Hronaut.',
    scope: 'L’archiviazione locale e i cookie sono condivisi per origine all’interno di quest’area di lavoro e isolati dalle altre aree di lavoro; l’archiviazione di sessione appartiene solo a questa scheda.',
    valuesIncluded: 'I valori vengono mostrati fino a un limite di dimensione. I valori dei cookie HttpOnly restano sempre protetti.',
    valuesOmitted: 'I valori vengono esclusi.',
    snapshot: 'Lo snapshot copre le prime 200 voci ordinate di ogni tipo di archiviazione. L’archiviazione può anche cambiare in background tra il riferimento e il confronto.'
  },
  pwa: {
    origin: 'È coperta solo questa origine di primo livello; i worker e le cache nei frame di terze parti non sono inclusi.',
    snapshot: 'Registrazioni e voci memorizzate nella cache sono uno snapshot di un preciso momento. Aggiorna dopo che il sito web ha modificato il suo stato offline.',
    manifest: 'Il manifest viene letto in alcuni campi limitati; la sua origine non elaborata non viene mai mostrata.',
    installabilityIds: 'Gli identificatori degli errori di installabilità provengono da Chromium e possono cambiare tra una versione di Chromium e l’altra.',
    readOnly: 'Questo strumento di ispezione legge soltanto i dati offline e non mostra mai i corpi delle risposte memorizzate nella cache.',
    headersIncluded: 'Le intestazioni di richiesta e risposta vengono mostrate fino a un limite; le intestazioni riconosciute come contenenti segreti vengono oscurate.',
    headersOmitted: 'I valori delle intestazioni vengono esclusi.',
    opaqueSizes: 'Le dimensioni delle risposte opache possono includere il riempimento della quota del browser e qui non vengono misurate.',
    clearing: 'Questo strumento di ispezione non annulla mai la registrazione dei worker né svuota le cache.',
    installabilityUnavailable: 'La diagnostica di installabilità non era disponibile: {reason}'
  }
}

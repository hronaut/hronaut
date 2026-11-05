export const itITHomeReadiness = {
  heading: 'Stato di preparazione MCP',
  description: 'Verifica separatamente ogni passaggio prima di affidarti agli strumenti del browser.',
  checks: {
    app: 'Applicazione',
    endpoint: 'Endpoint locale',
    initialization: 'Inizializzazione del client',
    advertisedTools: 'Strumenti annunciati',
    configuration: 'Configurazione del client',
    clientVisibility: 'Strumenti visibili nel client attivo',
    probe: 'Verifica in sola lettura'
  },
  inventory: 'Incolla l’elenco degli strumenti mostrato dal client attivo',
  inventoryPlaceholder: 'Incolla l’output del client contenente nomi di strumenti browser_* o wallet_*',
  verifyInventory: 'Confronta elenco strumenti',
  copyReport: 'Copia diagnostica',
  reportLabel: 'Diagnostica di preparazione MCP sicura da copiare',
  privacy: 'Il confronto resta su questa pagina. Il report copiato contiene solo stati tipizzati, conteggi, nomi di strumenti limitati e timestamp.',
  nextAction: {
    start_honaut: 'Avvia o ripara il listener locale di Hronaut.',
    connect_client: 'Riconnetti il client MCP attivo e attendi l’inizializzazione.',
    verify_client_configuration: 'Verifica questo endpoint e l’autenticazione nella configurazione del client attivo.',
    list_tools_in_active_client: 'Elenca gli strumenti nel client attivo e confrontali qui.',
    run_read_only_probe: 'In un’area di lavoro di proprietà dell’attività, richiama una volta browser_status o browser_snapshot.',
    retry_read_only_probe: 'Esamina l’errore del client attivo, quindi ripeti una verifica in sola lettura.',
    none: 'Nessuna azione necessaria per questo controllo.'
  }
}

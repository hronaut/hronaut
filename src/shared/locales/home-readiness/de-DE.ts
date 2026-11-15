export const deDEHomeReadiness = {
  heading: 'MCP-Bereitschaft',
  description: 'Prüfen Sie jede Stufe einzeln, bevor Sie sich auf Browserwerkzeuge verlassen.',
  checks: {
    app: 'Anwendung',
    endpoint: 'Lokaler Endpunkt',
    initialization: 'Client-Initialisierung',
    advertisedTools: 'Angebotene Werkzeuge',
    configuration: 'Client-Konfiguration',
    clientVisibility: 'Werkzeuge im aktiven Client sichtbar',
    probe: 'Nur-Lese-Testaufruf'
  },
  inventory: 'Fügen Sie die vom aktiven Client angezeigte Werkzeugliste ein',
  inventoryPlaceholder: 'Client-Ausgabe mit browser_*- oder wallet_*-Werkzeugnamen einfügen',
  verifyInventory: 'Werkzeugliste vergleichen',
  copyReport: 'Diagnose kopieren',
  reportLabel: 'Sicher kopierbare MCP-Bereitschaftsdiagnose',
  privacy: 'Der Vergleich bleibt auf dieser Seite. Der kopierte Bericht enthält nur typisierte Zustände, Anzahlen, begrenzte Werkzeugnamen und Zeitstempel.',
  nextAction: {
    start_honaut: 'Starten oder reparieren Sie den lokalen Hronaut-Listener.',
    connect_client: 'Verbinden Sie den aktiven MCP-Client erneut und warten Sie auf die Initialisierung.',
    verify_client_configuration: 'Bestätigen Sie diesen Endpunkt und die Authentifizierung in der Konfiguration des aktiven Clients.',
    list_tools_in_active_client: 'Listen Sie die Werkzeuge im aktiven Client auf und vergleichen Sie sie hier.',
    run_read_only_probe: 'Rufen Sie in einem aufgabeneigenen Arbeitsbereich einmal browser_status oder browser_snapshot auf.',
    retry_read_only_probe: 'Prüfen Sie den Fehler im aktiven Client und wiederholen Sie dann einen Nur-Lese-Testaufruf.',
    none: 'Für diese Prüfung ist keine Aktion erforderlich.'
  }
}

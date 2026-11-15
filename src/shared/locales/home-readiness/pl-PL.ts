export const plPLHomeReadiness = {
  heading: 'Gotowość MCP',
  description: 'Zanim zaczniesz polegać na narzędziach przeglądarki, sprawdź osobno każdą warstwę.',
  checks: {
    app: 'Aplikacja',
    endpoint: 'Lokalny punkt końcowy',
    initialization: 'Inicjalizacja klienta',
    advertisedTools: 'Udostępniane narzędzia',
    configuration: 'Konfiguracja klienta',
    clientVisibility: 'Narzędzia widoczne w aktywnym kliencie',
    probe: 'Test tylko do odczytu'
  },
  inventory: 'Wklej listę narzędzi pokazaną przez aktywnego klienta',
  inventoryPlaceholder: 'Wklej dane wyjściowe klienta zawierające nazwy narzędzi browser_* lub wallet_*',
  verifyInventory: 'Porównaj listę narzędzi',
  copyReport: 'Kopiuj diagnostykę',
  reportLabel: 'Diagnostyka gotowości MCP bezpieczna do skopiowania',
  privacy: 'Porównanie pozostaje na tej stronie. Skopiowany raport zawiera tylko typowane stany, liczniki, ograniczone nazwy narzędzi i znaczniki czasu.',
  nextAction: {
    start_honaut: 'Uruchom lub napraw lokalny serwer nasłuchujący Hronaut.',
    connect_client: 'Połącz ponownie aktywnego klienta MCP i poczekaj na inicjalizację.',
    verify_client_configuration: 'Potwierdź ten punkt końcowy i uwierzytelnianie w konfiguracji aktywnego klienta.',
    list_tools_in_active_client: 'Wyświetl listę narzędzi w aktywnym kliencie i porównaj ją tutaj.',
    run_read_only_probe: 'W obszarze roboczym należącym do zadania wywołaj raz browser_status lub browser_snapshot.',
    retry_read_only_probe: 'Sprawdź błąd aktywnego klienta, a następnie ponów jeden test tylko do odczytu.',
    none: 'Ta kontrola nie wymaga żadnych działań.'
  }
}

export const plPLTrustedDialogs = {
  close: 'Zamknij',
  httpAuth: {
    eyebrow: 'Logowanie',
    headline: 'Zaloguj się do {origin}',
    notPrivate: 'Połączenie z tą witryną nie jest prywatne. Każdy w sieci może odczytać Twoją nazwę użytkownika i hasło.',
    workspace: 'Pozostajesz zalogowany w tej witrynie w obszarze roboczym „{workspace}”, dopóki Hronaut nie zostanie zamknięty.',
    sent: 'Hronaut wysyła Twoją nazwę użytkownika i hasło tylko do tej witryny i nigdy nie pokazuje ich agentom.',
    username: 'Nazwa użytkownika',
    password: 'Hasło',
    signIn: 'Zaloguj się'
  },
  certificate: {
    eyebrow: 'Połączenie nieprywatne',
    headline: 'Przejść do {host}?',
    authority: 'Jej certyfikat bezpieczeństwa nie pochodzi od urzędu, któremu ufa ten komputer.',
    name: 'Jej certyfikat bezpieczeństwa należy do innej witryny.',
    date: 'Jej certyfikat bezpieczeństwa wygasł lub nie jest jeszcze ważny.',
    other: 'Nie można zweryfikować jej certyfikatu bezpieczeństwa.',
    risk: 'Ktoś w sieci może podszywać się pod tę witrynę, aby czytać to, co do niej wysyłasz, na przykład hasła.',
    workspace: 'Hronaut ufa temu certyfikatowi dla tej witryny w obszarze roboczym „{workspace}”, dopóki Hronaut nie zostanie zamknięty, a agenci w tym obszarze roboczym też mogą ją otwierać.',
    session: 'Hronaut ufa temu certyfikatowi dla tej witryny, dopóki Hronaut nie zostanie zamknięty.',
    back: 'Wróć do bezpiecznej strony',
    proceed: 'Przejdź (niebezpieczne)'
  },
  savePassword: {
    eyebrow: 'Zapisane hasła',
    save: 'Zapisać hasło dla {origin}?',
    update: 'Zaktualizować zapisane hasło dla {origin}?',
    username: 'Nazwa użytkownika',
    noUsername: 'Strona nie wysłała nazwy użytkownika.',
    stored: 'Hronaut szyfruje je za pomocą bezpiecznej pamięci systemu operacyjnego. Zapisane hasła nigdy nie są udostępniane przez MCP.'
  },
  walletRecovery: {
    eyebrow: 'Nowy portfel',
    headline: 'Zapisz frazę odzyskiwania portfela {wallet}',
    phrase: 'Fraza odzyskiwania',
    keep: 'Zapisz te słowa w tej kolejności i przechowuj je offline. Kto je zna, ten kontroluje portfel.',
    added: 'Hronaut doda portfel, gdy potwierdzisz ich zapisanie.'
  },
  claudeSetup: {
    file: 'Plik',
    added: 'Nowy wpis w "mcpServers"',
    replaces: 'Wpis, który zastąpi'
  },
  sitePermission: {
    embeddedIn: 'Osadzono w {site}',
    wants: {
      camera: '{origin} chce używać Twojej kamery',
      microphone: '{origin} chce używać Twojego mikrofonu',
      cameraAndMicrophone: '{origin} chce używać Twojej kamery i mikrofonu',
      geolocation: '{origin} chce znać Twoją lokalizację',
      notifications: '{origin} chce wyświetlać powiadomienia',
      clipboardRead: '{origin} chce widzieć tekst i obrazy, które kopiujesz',
      midiSysex: '{origin} chce sterować Twoimi urządzeniami MIDI i je przeprogramowywać',
      midi: '{origin} chce używać Twoich urządzeń MIDI',
      localFonts: '{origin} chce używać czcionek na Twoim komputerze',
      localNetwork: '{origin} chce wyszukiwać urządzenia w Twojej sieci lokalnej i łączyć się z nimi',
      loopbackNetwork: '{origin} chce łączyć się z aplikacjami i usługami na tym urządzeniu',
      fileSystem: '{origin} chce używać pliku lub folderu na Twoim komputerze',
      openExternal: '{origin} chce otworzyć aplikację na Twoim komputerze',
      idleDetection: '{origin} chce wiedzieć, kiedy używasz tego urządzenia',
      keyboardLock: '{origin} chce przechwytywać Twoje skróty klawiszowe',
      pointerLock: '{origin} chce zablokować i ukryć wskaźnik myszy',
      windowManagement: '{origin} chce zarządzać oknami na wszystkich Twoich ekranach',
      displayCapture: '{origin} chce widzieć Twój ekran',
      other: '{origin} chce używać uprawnienia „{permission}”'
    }
  }
}

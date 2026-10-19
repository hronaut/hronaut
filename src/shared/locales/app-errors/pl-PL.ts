import type { AppErrorMessages } from './en-US.js'

export const plPLAppErrors: AppErrorMessages = {
  "startup": {
    "initializing": "Zapisane obszary robocze wciąż się wczytują. Spróbuj ponownie po zakończeniu uruchamiania.",
    "unavailable": "Zapisane obszary robocze są niedostępne.",
    "readUnavailable": "Obszaru roboczego nie można już odczytać.",
    "tooManyReads": "Oczekuje zbyt wiele odczytów obszarów roboczych.",
    "metadataUnavailable": "Metadane zapisanych obszarów roboczych są niedostępne ({reason}). Uruchamianie zatrzymano, aby zachować możliwość odzyskania danych."
  },
  "sleep": {
    "onlyWebsites": "Uśpić można tylko nieaktywne karty ze stronami internetowymi.",
    "visible": "Widocznej karty nie można uśpić.",
    "pinned": "Przypięte karty pozostają aktywne.",
    "pageHold": "Karta, której strona jest celowo podtrzymywana, pozostaje aktywna.",
    "loading": "Wczytującej się karty nie można uśpić.",
    "audio": "Karta odtwarzająca dźwięk pozostaje aktywna.",
    "dialog": "Karta z otwartym oknem dialogowym pozostaje aktywna.",
    "wallet": "Karta czekająca na żądanie portfela pozostaje aktywna.",
    "devTools": "Karta z otwartymi narzędziami deweloperskimi pozostaje aktywna.",
    "interaction": "Karta z trwającą interakcją pozostaje aktywna.",
    "video": "Karta nagrywająca wideo pozostaje aktywna.",
    "repro": "Karta nagrywająca kroki odtworzenia pozostaje aktywna.",
    "domChanges": "Karta nagrywająca zmiany DOM pozostaje aktywna.",
    "liveRegion": "Karta nagrywająca region na żywo pozostaje aktywna.",
    "cssState": "Karta z wymuszonym stanem CSS pozostaje aktywna.",
    "domMutationSource": "Karta przechwytująca źródło zmiany DOM pozostaje aktywna.",
    "passkey": "Karta z wirtualnym kluczem dostępu pozostaje aktywna.",
    "logpoints": "Karta z aktywnymi logpointami pozostaje aktywna.",
    "coverage": "Karta nagrywająca pokrycie kodu pozostaje aktywna.",
    "cpuProfile": "Karta nagrywająca profil CPU JavaScriptu pozostaje aktywna.",
    "memory": "Karta nagrywająca alokacje pamięci pozostaje aktywna.",
    "mcpCommand": "Karta z trwającym poleceniem MCP pozostaje aktywna.",
    "download": "Karta z trwającym pobieraniem pozostaje aktywna.",
    "render": "Karta tworząca zrzut strony lub PDF pozostaje aktywna.",
    "unsavedForm": "Ta karta ma częściowo wypełniony formularz i pozostaje aktywna, aby nie utracić niezapisanych danych."
  },
  "splitView": {
    "sameTab": "Wybierz inną kartę do widoku dzielonego.",
    "home": "Strony głównej Hronaut nie można otworzyć w widoku dzielonym.",
    "currentUnavailable": "Bieżąca karta przestała działać. Zamknij ją i otwórz ponownie z listy Ostatnio zamknięte.",
    "selectedUnavailable": "Wybrana karta przestała działać. Zamknij ją i otwórz ponownie z listy Ostatnio zamknięte.",
    "notOpen": "Widok dzielony nie jest otwarty."
  },
  "clipboard": {
    "textTooLarge": "Tekst jest zbyt duży, aby bezpiecznie go skopiować (maksymalnie 8 MB).",
    "textRejected": "Tekst został przygotowany, ale schowek systemowy go nie przyjął.",
    "screenshotRejected": "Zrzut ekranu został wykonany, ale schowek systemowy nie przyjął obrazu.",
    "pageClosed": "Strona została zamknięta, zanim udało się skopiować jej obraz.",
    "imageRejected": "Obraz na stronie został wybrany, ale schowek systemowy go nie przyjął."
  },
  "tabs": {
    "noActiveTab": "Brak aktywnej karty.",
    "rendererUnavailable": "Ta karta przestała działać. Zamknij ją i otwórz ponownie z listy Ostatnio zamknięte.",
    "limit": "Osiągnięto limit kart ({max}).",
    "homeNotPinned": "Strony głównej Hronaut nie można przypiąć.",
    "homeNotReordered": "Strony głównej Hronaut nie można przenosić.",
    "pinnedBoundary": "Przypnij lub odepnij kartę, zanim przeniesiesz ją między przypiętymi a zwykłymi kartami.",
    "otherWorkspace": "Karty można przestawiać tylko w obrębie jednego obszaru roboczego.",
    "homeNotDuplicated": "Strony głównej Hronaut nie można zduplikować.",
    "homeInAgentWorkspace": "Strona główna Hronaut to strona aplikacji dla ludzi i nie można jej dodać do obszaru roboczego agenta.",
    "workspaceCleanupFailed": "Nie udało się otworzyć nowej karty ani uporządkować jej obszaru roboczego. Obszar roboczy pozostaje dostępny do odzyskania."
  },
  "page": {
    "rendererExitedDuringAction": "Strona zatrzymała się podczas tej czynności, bo jej proces się zakończył; skutki są nieznane. Odśwież lub zamknij kartę, a potem sprawdź jej bieżący stan.",
    "rendererExitedBeforeAction": "Strona nie działa, bo jej proces się zakończył; nic do niej nie wysłano. Odśwież lub zamknij kartę, a potem sprawdź jej bieżący stan.",
    "closedWhileWaiting": "Karta została zamknięta podczas oczekiwania na stronę.",
    "rendererLostWhileWaiting": "Karta przestała działać podczas oczekiwania na stronę.",
    "loadTimedOut": "Upłynął limit czasu oczekiwania na wczytanie strony.",
    "zoomPercent": "Powiększenie strony musi być liczbą całkowitą od 50 do 400 procent.",
    "findQuery": "Wyszukiwana fraza musi mieć od 1 do 1000 znaków."
  },
  "loadFailure": {
    "nameNotResolved": "Nie udało się znaleźć adresu witryny ({code}).",
    "connectionRefused": "Witryna odrzuciła połączenie ({code}).",
    "offline": "Urządzenie prawdopodobnie jest offline ({code}).",
    "timedOut": "Witryna odpowiadała zbyt długo ({code}).",
    "connectionReset": "Połączenie zostało zresetowane podczas wczytywania strony ({code}).",
    "certificate": "Hronaut nie ufa certyfikatowi bezpieczeństwa tej witryny ({code})."
  },
  "navigation": {
    "homeInAgentWorkspace": "Strona główna Hronaut to strona aplikacji dla ludzi i nie można jej otworzyć w obszarze roboczym agenta.",
    "agentSchemes": "Obszary robocze agentów nie mogą otwierać lokalnych ani uprzywilejowanych adresów przeglądarki ani adresów z danymi logowania.",
    "originBlocked": "Przejście do {origin} jest zablokowane w tym obszarze roboczym. Zezwól na to źródło w ustawieniach Dostęp do witryn zaufanego obszaru roboczego.",
    "observerOrigin": "Źródła publicznego obserwatora nie można zmienić ani rozszerzyć.",
    "recoveryRunning": "Karta jest już przywracana.",
    "recoveryPageChanged": "Strona zmieniła się podczas przywracania karty.",
    "recoveryTabClosed": "Karta została zamknięta podczas przywracania.",
    "recoveryTimedOut": "Nie udało się przywrócić karty na czas."
  },
  "workspace": {
    "unavailable": "Obszar roboczy nie jest już dostępny.",
    "busyArchiving": "Obszar roboczy „{name}” jest właśnie archiwizowany. Spróbuj ponownie po zakończeniu tej operacji.",
    "busyClosing": "Obszar roboczy „{name}” jest właśnie zamykany. Spróbuj ponownie po zakończeniu tej operacji.",
    "busyForking": "Trwa tworzenie kopii obszaru roboczego „{name}”. Spróbuj ponownie po zakończeniu tej operacji.",
    "busyRestoring": "Obszar roboczy „{name}” jest właśnie przywracany z archiwum. Spróbuj ponownie po zakończeniu tej operacji.",
    "busyClearingData": "Trwa czyszczenie danych witryn w obszarze roboczym „{name}”. Spróbuj ponownie po zakończeniu tej operacji.",
    "busyMovingData": "Trwa przenoszenie danych obszaru roboczego „{name}”. Spróbuj ponownie po zakończeniu tej operacji.",
    "busyCopyingData": "Trwa kopiowanie danych obszaru roboczego „{name}”. Spróbuj ponownie po zakończeniu tej operacji.",
    "busyImportingCookies": "Trwa importowanie plików cookie przeglądarki do obszaru roboczego „{name}”. Spróbuj ponownie po zakończeniu tej operacji."
  },
  "lifecycle": {
    "homeTab": "Zamrażać i wznawiać można tylko karty z działającymi stronami.",
    "sleeping": "Wybudź uśpioną kartę, zanim zmienisz stan jej strony.",
    "rendererUnavailable": "Karta w tej chwili nie działa.",
    "closedWhileChanging": "Karta została zamknięta podczas zmiany stanu jej strony.",
    "closedBeforeDispatch": "Karta została zamknięta, zanim wysłano polecenie zmiany stanu strony.",
    "documentChanged": "Strona zmieniła się, zanim wysłano polecenie zmiany jej stanu.",
    "devTools": "Zamknij narzędzia deweloperskie tej karty, zanim zmienisz stan jej strony."
  },
  "inputLock": {
    "pageBusy": "Strona jest zajęta. Blokady wprowadzania nie zostały zmienione. Poczekaj, aż jej operacja się zakończy, i spróbuj ponownie.",
    "observer": "Wprowadzanie na stronie pozostaje zablokowane w obszarze roboczym publicznego obserwatora tylko do odczytu.",
    "tabClosed": "Karta została zamknięta, zanim zmieniono jej blokadę wprowadzania.",
    "tabNotRestored": "Nie udało się zmienić ani przywrócić blokady wprowadzania tej karty.",
    "allNotRestored": "Nie udało się zmienić ani przywrócić globalnej blokady wprowadzania dla wszystkich kart.",
    "allNotUpdated": "Nie udało się zmienić globalnej blokady wprowadzania dla wszystkich kart."
  },
  "agentPause": {
    "serviceUnavailable": "Usługa agentów jest niedostępna."
  },
  "devTools": {
    "targetChanged": "Karta zmieniła się przed otwarciem narzędzi deweloperskich.",
    "conditionsPending": "Warunki żądań są wciąż stosowane. Poczekaj na zakończenie, zanim otworzysz narzędzia deweloperskie.",
    "conditionsChanged": "Warunki żądań zmieniły się przed otwarciem narzędzi deweloperskich."
  },
  "bookmarks": {
    "invalidUrl": "Adres zakładki musi być adresem HTTP lub HTTPS o długości do 4096 zakodowanych znaków.",
    "limit": "Osiągnięto limit zakładek ({max}).",
    "duplicate": "Ten adres jest już w zakładkach.",
    "unavailable": "Zakładka nie jest już dostępna.",
    "collectionLimit": "Osiągnięto limit kolekcji (50).",
    "collectionMissing": "Nie znaleziono kolekcji zakładek.",
    "collectionNameTaken": "Kolekcja zakładek o tej nazwie już istnieje.",
    "collectionName": "Nazwa kolekcji musi mieć od 1 do 80 znaków.",
    "storageUnavailable": "Magazyn zakładek jest niedostępny.",
    "historyUnavailable": "Historia odwiedzin jest niedostępna."
  },
  "startupScreen": {
    "title": "Nie udało się uruchomić Hronaut",
    "description": "Interfejs aplikacji nie mógł wczytać początkowych ustawień.",
    "retry": "Spróbuj ponownie",
    "privacy": "Twój profil przeglądarki pozostaje na tym urządzeniu.",
    "settingsUnavailable": "Usługa ustawień interfejsu jest niedostępna."
  }
}

import type { AppErrorMessages } from './en-US.js'

export const plPLAppErrors: AppErrorMessages = {
  "startup": {
    "initializing": "Zapisane obszary robocze wciąż się wczytują. Spróbuj ponownie po zakończeniu uruchamiania.",
    "unavailable": "Zapisane obszary robocze są niedostępne.",
    "readUnavailable": "Obszaru roboczego nie można już odczytać.",
    "tooManyReads": "Oczekuje zbyt wiele odczytów obszarów roboczych."
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
  "startupScreen": {
    "title": "Nie udało się uruchomić Hronaut",
    "description": "Interfejs aplikacji nie mógł wczytać początkowych ustawień.",
    "retry": "Spróbuj ponownie",
    "privacy": "Twój profil przeglądarki pozostaje na tym urządzeniu.",
    "settingsUnavailable": "Usługa ustawień interfejsu jest niedostępna."
  }
}

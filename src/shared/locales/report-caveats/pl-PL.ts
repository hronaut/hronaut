export const plPLReportCaveats = {
  performance: {
    lcpPhases: 'Fazy LCP to pomiary czasu przeglądarki, a nie dowód przyczyny. Brakujące lub ograniczone dane są wyraźnie oznaczone; fazy po przywróceniu strony i w miękkiej nawigacji nie są przypisywane.',
    localSample: 'To pojedyncza lokalna próbka bieżącej wizyty, a nie dane terenowe ani wynik CrUX dla 75. percentyla.',
    inpUnavailable: 'INP jest niedostępny, dopóki strona nie otrzyma kwalifikującej się interakcji; niektóre metryki są niedostępne dla wizyt w tle lub bardzo krótkich.',
    longAnimationFrames: 'Przypisanie długich klatek animacji wskazuje punkty wejścia skryptów, niekoniecznie najwolniejszą funkcję wewnętrzną.',
    crossOrigin: 'Ramki z innych źródeł, workery, service workery i kod w izolowanych światach mogą wykonywać pracę bez przypisania do skryptu.',
    userTimings: 'Nazwy czasów użytkownika pochodzą ze strony i są oczyszczane; dowolne obiekty szczegółów, stosy wywołań i kod źródłowy są pomijane.',
    layoutShifts: 'Przesunięcia układu tuż po wprowadzeniu danych są pomijane. Suma ich wyników służy diagnozie i może różnić się od CLS liczonego w oknach sesji.',
    baselineUrl: 'Adres stanu bazowego różni się od tego pomiaru; porównuj tylko wtedy, gdy zmiana nawigacji była zamierzona.',
    environment: 'Środowisko przeglądarki różni się od stanu bazowego; zmiany obszaru wyświetlania, ograniczania, pamięci podręcznej, nagłówków lub języka mogą wpłynąć na różnicę.',
    deltas: 'Różnice przed i po porównują dwie lokalne próbki i mogą obejmować zwykłe wahania między przebiegami; powtarzaj ważne pomiary w tych samych warunkach.'
  },
  accessibilityComparison: {
    urlChanged: 'Adres strony zmienił się od ustawienia punktu odniesienia dostępności.',
    scopeChanged: 'Zmienił się standard, selektor lub limity zbierania audytu; ustaw nowy punkt odniesienia dla tego zakresu.',
    engineChanged: 'Zmienił się silnik audytu; ustaw nowy punkt odniesienia przed porównaniem problemów.',
    baselineTruncated: 'Punkt odniesienia został obcięty, więc nie da się bezpiecznie ustalić nowych problemów.',
    currentTruncated: 'Bieżący audyt został obcięty, więc nie da się bezpiecznie ustalić rozwiązanych problemów.'
  },
  indexedDb: {
    origin: 'Uwzględniane jest tylko to źródło najwyższego poziomu; bazy danych ramek innych firm są pomijane.',
    snapshot: 'Bazy danych i rekordy to migawka z danej chwili. Odśwież po zmianie IndexedDB przez witrynę.',
    names: 'Nazwy baz danych, magazynów obiektów, indeksów i kluczy pochodzą z witryny i same mogą zawierać prywatne dane.',
    longNames: 'Bazy danych i magazyny obiektów o nazwach dłuższych niż 512 znaków są pomijane.',
    valuesIncluded: 'Podglądy rekordów są ograniczone i mogą zawierać prywatne dane aplikacji.',
    valuesOmitted: 'Wartości rekordów są pomijane.',
    readOnly: 'Ten inspektor tylko odczytuje IndexedDB i nigdy go nie zmienia ani nie czyści.'
  },
  storageUsage: {
    estimates: 'Użycie i limit to chwilowe szacunki przeglądarki i mogą się zmienić, gdy Chromium usuwa lub zapisuje dane.',
    quota: 'Limit to budżet, który Chromium obecnie podaje dla tego źródła, a nie wolne miejsce na urządzeniu.',
    origin: 'Uwzględniane jest tylko to źródło HTTP(S) najwyższego poziomu; pamięć innych firm i pamięć partycjonowana mogą być liczone osobno.',
    aggregates: 'Pokazywane są tylko łączne liczby bajtów i kategorie pamięci przeglądarki. Klucze, wartości, nazwy plików i treści odpowiedzi nigdy nie są uwzględniane.',
    readOnly: 'Ten inspektor tylko odczytuje użycie pamięci i nigdy nie zmienia ani nie czyści danych.',
    fallback: 'Szczegółowy podział limitu z Chromium był niedostępny, więc ten raport używa ogólnego szacunku przeglądarki: {reason}'
  },
  storageChanges: {
    baseline: 'Stan bazowy jest przechowywany tylko w pamięci i usuwany, gdy go wyczyścisz, gdy karta zmieni źródło lub zostanie zamknięta albo gdy Hronaut zostanie zamknięty.',
    scope: 'Pamięć lokalna i pliki cookie są współdzielone według źródła w tym obszarze roboczym i odizolowane od innych obszarów roboczych; pamięć sesji należy tylko do tej karty.',
    valuesIncluded: 'Wartości są pokazywane do limitu rozmiaru. Wartości plików cookie HttpOnly zawsze pozostają chronione.',
    valuesOmitted: 'Wartości są pomijane.',
    snapshot: 'Migawka obejmuje pierwsze 200 posortowanych wpisów każdego rodzaju pamięci. Pamięć może też zmienić się w tle między stanem bazowym a porównaniem.'
  },
  pwa: {
    origin: 'Uwzględniane jest tylko to źródło najwyższego poziomu; workery i pamięci podręczne ramek innych firm są pomijane.',
    snapshot: 'Rejestracje i wpisy w pamięci podręcznej to migawka z danej chwili. Odśwież po zmianie stanu offline przez witrynę.',
    manifest: 'Manifest jest odczytywany do kilku ograniczonych pól; jego surowe źródło nigdy nie jest pokazywane.',
    installabilityIds: 'Identyfikatory błędów możliwości instalacji pochodzą z Chromium i mogą się zmieniać między wersjami Chromium.',
    readOnly: 'Ten inspektor tylko odczytuje dane offline i nigdy nie pokazuje treści odpowiedzi z pamięci podręcznej.',
    headersIncluded: 'Nagłówki żądań i odpowiedzi są pokazywane do limitu; rozpoznane nagłówki z sekretami są ukrywane.',
    headersOmitted: 'Wartości nagłówków są pomijane.',
    opaqueSizes: 'Rozmiary nieprzezroczystych odpowiedzi mogą obejmować dopełnienie limitu przeglądarki i nie są tu mierzone.',
    clearing: 'Ten inspektor nigdy nie wyrejestrowuje workerów ani nie czyści pamięci podręcznych.',
    installabilityUnavailable: 'Diagnostyka możliwości instalacji była niedostępna: {reason}'
  }
}

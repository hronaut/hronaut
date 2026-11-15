export const plPLReproSteps = {
  kinds: {
    navigate: 'nawigacja',
    click: 'kliknięcie',
    input: 'wpisywanie',
    key: 'klawisz',
    scroll: 'przewijanie',
    expect: 'sprawdzenie'
  },
  steps: {
    open: 'Otwórz {url}',
    navigate: 'Przejdź do {url}',
    navigateWithin: 'Przejdź w obrębie strony do {url}',
    click: 'Kliknij {target}',
    input: 'Wpisz w {target} (wartość nie została zarejestrowana)',
    key: 'Naciśnij {key} (cel: {target})',
    scroll: 'Przewiń do x={x}, y={y}',
    expect: 'Oczekiwany wynik: {condition}',
    captureFailed: 'Nie udało się przechwycić celu działania; odtwórz to działanie ręcznie.',
    captureInterrupted: 'Nawigacja przerwała przechwytywanie działania; odtwórz to działanie ręcznie.'
  },
  targets: {
    input: 'pole {type}',
    labelled: '{kind} „{label}”'
  },
  conditions: {
    visible: 'widoczny',
    hidden: 'ukryty',
    text: 'dokładny tekst',
    checked: 'zaznaczony',
    unchecked: 'niezaznaczony',
    count: 'liczba elementów',
    urlPath: 'ścieżka URL'
  }
}

export const deDEReproSteps = {
  kinds: {
    navigate: 'Navigation',
    click: 'Klick',
    input: 'Eingabe',
    key: 'Taste',
    scroll: 'Scrollen',
    expect: 'Prüfpunkt'
  },
  steps: {
    open: 'Öffnen: {url}',
    navigate: 'Navigieren zu {url}',
    navigateWithin: 'Innerhalb der Seite navigieren zu {url}',
    click: '{target} anklicken',
    input: 'In {target} tippen (Wert nicht aufgezeichnet)',
    key: '{key} in {target} drücken',
    scroll: 'Zu x={x}, y={y} scrollen',
    expect: 'Erwartetes Ergebnis: {condition}',
    captureFailed: 'Das Ziel der Aktion konnte nicht erfasst werden. Diese Aktion manuell nachbilden.',
    captureInterrupted: 'Die Erfassung der Aktion wurde durch eine Navigation unterbrochen. Diese Aktion manuell nachbilden.'
  },
  targets: {
    input: '{type}-Eingabefeld',
    labelled: '{kind} „{label}“'
  },
  conditions: {
    visible: 'sichtbar',
    hidden: 'verborgen',
    text: 'exakter Text',
    checked: 'ausgewählt',
    unchecked: 'nicht ausgewählt',
    count: 'Elementanzahl',
    urlPath: 'URL-Pfad'
  }
}

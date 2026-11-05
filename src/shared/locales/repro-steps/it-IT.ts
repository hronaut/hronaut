export const itITReproSteps = {
  kinds: {
    navigate: 'navigazione',
    click: 'clic',
    input: 'inserimento',
    key: 'tasto',
    scroll: 'scorrimento',
    expect: 'verifica'
  },
  steps: {
    open: 'Apri {url}',
    navigate: 'Vai a {url}',
    navigateWithin: 'Vai a {url} all’interno della pagina',
    click: 'Fai clic su {target}',
    input: 'Digita in {target} (valore non registrato)',
    key: 'Premi {key} su {target}',
    scroll: 'Scorri fino a x={x}, y={y}',
    expect: 'Risultato previsto: {condition}',
    captureFailed: 'Impossibile acquisire la destinazione dell’azione; ricrea questa azione manualmente.',
    captureInterrupted: 'Acquisizione dell’azione interrotta dalla navigazione; ricrea questa azione manualmente.'
  },
  targets: {
    input: 'campo {type}',
    labelled: '{kind} “{label}”'
  },
  conditions: {
    visible: 'visibile',
    hidden: 'nascosto',
    text: 'testo',
    checked: 'selezionato',
    unchecked: 'non selezionato',
    count: 'conteggio',
    urlPath: 'percorso URL'
  }
}

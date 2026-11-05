export const ptBRReproSteps = {
  kinds: {
    navigate: 'navegar',
    click: 'clicar',
    input: 'digitar',
    key: 'tecla',
    scroll: 'rolar',
    expect: 'esperar'
  },
  steps: {
    open: 'Abrir {url}',
    navigate: 'Navegar para {url}',
    navigateWithin: 'Navegar dentro da página para {url}',
    click: 'Clicar em {target}',
    input: 'Digitar em {target} (valor não gravado)',
    key: 'Pressionar {key} em {target}',
    scroll: 'Rolar até x={x}, y={y}',
    expect: 'Resultado esperado: {condition}',
    captureFailed: 'Não foi possível capturar o alvo da ação; recrie esta ação manualmente.',
    captureInterrupted: 'A captura da ação foi interrompida por uma navegação; recrie esta ação manualmente.'
  },
  targets: {
    input: 'campo {type}',
    labelled: '{kind} “{label}”'
  },
  conditions: {
    visible: 'visível',
    hidden: 'oculto',
    text: 'texto',
    checked: 'marcado',
    unchecked: 'desmarcado',
    count: 'contagem',
    urlPath: 'caminho do URL'
  }
}

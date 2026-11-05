export const esESReproSteps = {
  kinds: {
    navigate: 'navegación',
    click: 'clic',
    input: 'entrada',
    key: 'tecla',
    scroll: 'desplazamiento',
    expect: 'comprobación'
  },
  steps: {
    open: 'Abrir {url}',
    navigate: 'Ir a {url}',
    navigateWithin: 'Ir a {url} dentro de la página',
    click: 'Hacer clic en {target}',
    input: 'Escribir en {target} (valor no registrado)',
    key: 'Pulsar {key} en {target}',
    scroll: 'Desplazarse hasta x={x}, y={y}',
    expect: 'Resultado esperado: {condition}',
    captureFailed: 'No se pudo capturar el objetivo de la acción; recrea esta acción manualmente.',
    captureInterrupted: 'Una navegación interrumpió la captura de la acción; recrea esta acción manualmente.'
  },
  targets: {
    input: 'campo {type}',
    labelled: '{kind} «{label}»'
  },
  conditions: {
    visible: 'visible',
    hidden: 'oculto',
    text: 'texto exacto',
    checked: 'marcado',
    unchecked: 'sin marcar',
    count: 'cantidad de elementos',
    urlPath: 'ruta de URL'
  }
}

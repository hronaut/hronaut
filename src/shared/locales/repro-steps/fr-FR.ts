export const frFRReproSteps = {
  kinds: {
    navigate: 'navigation',
    click: 'clic',
    input: 'saisie',
    key: 'touche',
    scroll: 'défilement',
    expect: 'vérification'
  },
  steps: {
    open: 'Ouvrir {url}',
    navigate: 'Naviguer vers {url}',
    navigateWithin: 'Naviguer dans la page vers {url}',
    click: 'Cliquer sur {target}',
    input: 'Saisir dans {target} (valeur non enregistrée)',
    key: 'Appuyer sur {key} dans {target}',
    scroll: 'Faire défiler jusqu’à x={x}, y={y}',
    expect: 'Résultat attendu : {condition}',
    captureFailed: 'La cible de l’action n’a pas pu être capturée ; recréez cette action manuellement.',
    captureInterrupted: 'Une navigation a interrompu la capture de l’action ; recréez cette action manuellement.'
  },
  targets: {
    input: 'champ {type}',
    labelled: '{kind} « {label} »'
  },
  conditions: {
    visible: 'visible',
    hidden: 'masqué',
    text: 'texte exact',
    checked: 'coché',
    unchecked: 'non coché',
    count: 'nombre d’éléments',
    urlPath: 'chemin URL'
  }
}

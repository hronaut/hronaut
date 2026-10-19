import type { AppErrorMessages } from './en-US.js'

export const frFRAppErrors: AppErrorMessages = {
  "startup": {
    "initializing": "Les espaces de travail enregistrés sont encore en cours de chargement. Réessayez une fois le démarrage terminé.",
    "unavailable": "Les espaces de travail enregistrés sont indisponibles.",
    "readUnavailable": "L’espace de travail ne peut plus être lu.",
    "tooManyReads": "Trop de lectures d’espaces de travail sont en attente."
  },
  "sleep": {
    "onlyWebsites": "Seuls les onglets de sites web inactifs peuvent être mis en veille.",
    "visible": "Un onglet visible ne peut pas être mis en veille.",
    "pinned": "Les onglets épinglés restent actifs.",
    "pageHold": "Un onglet dont la page est explicitement maintenue reste actif.",
    "loading": "Un onglet en cours de chargement ne peut pas être mis en veille.",
    "audio": "Un onglet qui lit du son reste actif.",
    "dialog": "Un onglet avec une boîte de dialogue ouverte reste actif.",
    "wallet": "Un onglet qui attend une demande de portefeuille reste actif.",
    "devTools": "Un onglet avec les outils de développement ouverts reste actif.",
    "interaction": "Un onglet avec une interaction en cours reste actif.",
    "video": "Un onglet qui enregistre une vidéo reste actif.",
    "repro": "Un onglet qui enregistre des étapes de reproduction reste actif.",
    "domChanges": "Un onglet qui enregistre des modifications du DOM reste actif.",
    "liveRegion": "Un onglet qui enregistre une région live reste actif.",
    "cssState": "Un onglet avec un état CSS forcé reste actif.",
    "domMutationSource": "Un onglet qui capture la source d’une modification du DOM reste actif.",
    "passkey": "Un onglet avec une clé d’accès virtuelle reste actif.",
    "logpoints": "Un onglet avec des logpoints actifs reste actif.",
    "coverage": "Un onglet qui enregistre la couverture du code reste actif.",
    "cpuProfile": "Un onglet qui enregistre un profil CPU JavaScript reste actif.",
    "memory": "Un onglet qui enregistre les allocations mémoire reste actif.",
    "mcpCommand": "Un onglet avec une commande MCP en cours reste actif.",
    "download": "Un onglet avec un téléchargement en cours reste actif.",
    "render": "Un onglet qui crée une capture de page ou un PDF reste actif.",
    "unsavedForm": "Cet onglet contient un formulaire partiellement rempli et reste actif pour ne pas perdre la saisie non enregistrée."
  },
  "splitView": {
    "sameTab": "Choisissez un autre onglet pour la vue fractionnée.",
    "home": "L’accueil Hronaut ne peut pas être ouvert en vue fractionnée.",
    "currentUnavailable": "L’onglet actuel ne fonctionne plus. Fermez-le et rouvrez-le depuis Fermés récemment.",
    "selectedUnavailable": "L’onglet sélectionné ne fonctionne plus. Fermez-le et rouvrez-le depuis Fermés récemment.",
    "notOpen": "La vue fractionnée n’est pas ouverte."
  },
  "clipboard": {
    "textTooLarge": "Le texte est trop volumineux pour être copié en toute sécurité (8 Mo maximum).",
    "textRejected": "Le texte a été préparé, mais le presse-papiers du système ne l’a pas accepté.",
    "screenshotRejected": "La capture d’écran a été prise, mais le presse-papiers du système n’a pas accepté l’image.",
    "pageClosed": "La page s’est fermée avant que son image puisse être copiée.",
    "imageRejected": "L’image de la page a été sélectionnée, mais le presse-papiers du système ne l’a pas acceptée."
  },
  "startupScreen": {
    "title": "Hronaut n’a pas pu démarrer",
    "description": "L’interface de l’application n’a pas pu charger ses paramètres initiaux.",
    "retry": "Réessayer",
    "privacy": "Votre profil de navigateur reste sur cet appareil.",
    "settingsUnavailable": "Le service de paramètres de l’interface est indisponible."
  }
}

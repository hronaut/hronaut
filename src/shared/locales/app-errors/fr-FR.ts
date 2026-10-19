import type { AppErrorMessages } from './en-US.js'

export const frFRAppErrors: AppErrorMessages = {
  "startup": {
    "initializing": "Les espaces de travail enregistrés sont encore en cours de chargement. Réessayez une fois le démarrage terminé.",
    "unavailable": "Les espaces de travail enregistrés sont indisponibles.",
    "readUnavailable": "L’espace de travail ne peut plus être lu.",
    "tooManyReads": "Trop de lectures d’espaces de travail sont en attente.",
    "metadataUnavailable": "Les métadonnées des espaces de travail enregistrés sont indisponibles ({reason}). Le démarrage a été arrêté pour préserver les options de récupération."
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
    "currentUnavailable": "L’onglet actuel ne fonctionne plus. Fermez-le et rouvrez-le depuis « Fermés récemment ».",
    "selectedUnavailable": "L’onglet sélectionné ne fonctionne plus. Fermez-le et rouvrez-le depuis « Fermés récemment ».",
    "notOpen": "La vue fractionnée n’est pas ouverte."
  },
  "clipboard": {
    "textTooLarge": "Le texte est trop volumineux pour être copié en toute sécurité (8 Mo maximum).",
    "textRejected": "Le texte a été préparé, mais le presse-papiers du système ne l’a pas accepté.",
    "screenshotRejected": "La capture d’écran a été prise, mais le presse-papiers du système n’a pas accepté l’image.",
    "pageClosed": "La page s’est fermée avant que son image puisse être copiée.",
    "imageRejected": "L’image de la page a été sélectionnée, mais le presse-papiers du système ne l’a pas acceptée."
  },
  "tabs": {
    "noActiveTab": "Aucun onglet n’est actif.",
    "rendererUnavailable": "Cet onglet ne répond plus. Fermez-le et rouvrez-le depuis « Fermés récemment ».",
    "limit": "Limite d’onglets atteinte ({max}).",
    "homeNotPinned": "L’accueil Hronaut ne peut pas être épinglé.",
    "homeNotReordered": "L’accueil Hronaut ne peut pas être déplacé.",
    "pinnedBoundary": "Épinglez ou désépinglez l’onglet avant de le déplacer entre les onglets épinglés et les autres.",
    "otherWorkspace": "Les onglets ne peuvent être réorganisés qu’au sein du même espace de travail.",
    "homeNotDuplicated": "L’accueil Hronaut ne peut pas être dupliqué.",
    "homeInAgentWorkspace": "L’accueil Hronaut est une page de l’application destinée aux personnes et ne peut pas être ajouté à un espace de travail d’agent.",
    "workspaceCleanupFailed": "Le nouvel onglet n’a pas pu s’ouvrir et son espace de travail n’a pas pu être nettoyé. L’espace de travail reste disponible pour la récupération.",
    "labelBusy": "Attendez la fin de l’opération sur l’onglet avant de modifier son libellé.",
    "labelsPending": "Attendez la fin des modifications de libellé en cours.",
    "homeNotLabeled": "L’accueil Hronaut ne peut pas recevoir de libellé."
  },
  "page": {
    "rendererExitedDuringAction": "La page s’est arrêtée pendant cette action, car son processus s’est terminé ; ses effets sont inconnus. Rechargez ou fermez l’onglet, puis vérifiez son état actuel.",
    "rendererExitedBeforeAction": "La page ne s’exécute pas, car son processus s’est terminé ; rien ne lui a été envoyé. Rechargez ou fermez l’onglet, puis vérifiez son état actuel.",
    "closedWhileWaiting": "L’onglet s’est fermé pendant l’attente de la page.",
    "rendererLostWhileWaiting": "L’onglet a cessé de répondre pendant l’attente de la page.",
    "loadTimedOut": "Le délai d’attente du chargement de la page est dépassé.",
    "zoomPercent": "Le zoom de la page doit être un nombre entier compris entre 50 et 400 pour cent.",
    "findQuery": "La recherche doit contenir entre 1 et 1000 caractères."
  },
  "loadFailure": {
    "nameNotResolved": "Impossible de trouver l’adresse du site web ({code}).",
    "connectionRefused": "Le site web a refusé la connexion ({code}).",
    "offline": "L’appareil semble hors ligne ({code}).",
    "timedOut": "Le site web a mis trop de temps à répondre ({code}).",
    "connectionReset": "La connexion a été réinitialisée pendant le chargement de la page ({code}).",
    "nameResolutionFailed": "Impossible de résoudre l’adresse du site web ({code}).",
    "addressUnreachable": "Impossible d’atteindre l’adresse ({code}).",
    "connectionClosed": "La connexion s’est fermée avant la réception de la page ({code}).",
    "emptyResponse": "Le site web n’a envoyé aucune donnée ({code}).",
    "certificate": "Hronaut ne fait pas confiance au certificat de sécurité de ce site web ({code})."
  },
  "navigation": {
    "homeInAgentWorkspace": "L’accueil Hronaut est une page de l’application destinée aux personnes et ne peut pas être ouvert dans un espace de travail d’agent.",
    "agentSchemes": "Les espaces de travail d’agent ne peuvent pas ouvrir d’adresses de navigateur locales, privilégiées ou contenant des identifiants.",
    "originBlocked": "La navigation vers {origin} est bloquée dans cet espace de travail. Autorisez cette origine dans les paramètres « Accès aux sites » de l’espace de travail de confiance.",
    "observerOrigin": "L’origine d’un observateur public ne peut être ni modifiée ni élargie.",
    "recoveryRunning": "L’onglet est déjà en cours de récupération.",
    "recoveryPageChanged": "La page a changé pendant la récupération de l’onglet.",
    "recoveryTabClosed": "L’onglet s’est fermé pendant sa récupération.",
    "recoveryTimedOut": "L’onglet n’a pas pu être récupéré à temps."
  },
  "workspace": {
    "unavailable": "L’espace de travail n’est plus disponible.",
    "archivedUnavailable": "L’espace de travail archivé n’est plus disponible.",
    "busyArchiving": "L’espace de travail « {name} » est en cours d’archivage. Réessayez une fois l’opération terminée.",
    "busyClosing": "L’espace de travail « {name} » est en cours de fermeture. Réessayez une fois l’opération terminée.",
    "busyForking": "Une copie de l’espace de travail « {name} » est en cours de création. Réessayez une fois l’opération terminée.",
    "busyRestoring": "L’espace de travail « {name} » est en cours de restauration depuis l’archive. Réessayez une fois l’opération terminée.",
    "busyClearingData": "Les données des sites de l’espace de travail « {name} » sont en cours d’effacement. Réessayez une fois l’opération terminée.",
    "busyMovingData": "Les données de l’espace de travail « {name} » sont en cours de déplacement. Réessayez une fois l’opération terminée.",
    "busyCopyingData": "Les données de l’espace de travail « {name} » sont en cours de copie. Réessayez une fois l’opération terminée.",
    "busyImportingCookies": "Des cookies du navigateur sont en cours d’importation dans l’espace de travail « {name} ». Réessayez une fois l’opération terminée."
  },
  "lifecycle": {
    "homeTab": "Seuls les onglets dont la page est en cours d’exécution peuvent être figés ou repris.",
    "sleeping": "Réveillez l’onglet en veille avant de modifier l’état de sa page.",
    "rendererUnavailable": "L’onglet ne répond pas pour le moment.",
    "closedWhileChanging": "L’onglet s’est fermé pendant la modification de l’état de sa page.",
    "closedBeforeDispatch": "L’onglet s’est fermé avant l’envoi de la commande de changement d’état de la page.",
    "documentChanged": "La page a changé avant l’envoi de la commande de changement de son état.",
    "devTools": "Fermez les outils de développement de cet onglet avant de modifier l’état de sa page."
  },
  "inputLock": {
    "pageBusy": "Une page est occupée. Les verrous de saisie n’ont pas été modifiés. Attendez la fin de son opération, puis réessayez.",
    "observer": "La saisie reste verrouillée dans un espace de travail d’observateur public en lecture seule.",
    "tabClosed": "L’onglet s’est fermé avant la modification de son verrou de saisie.",
    "tabNotRestored": "Le verrou de saisie de cet onglet n’a pu être ni modifié ni rétabli.",
    "allNotRestored": "Le verrou de saisie global n’a pu être ni modifié ni rétabli pour tous les onglets.",
    "allNotUpdated": "Le verrou de saisie global n’a pas pu être modifié pour tous les onglets."
  },
  "agentPause": {
    "serviceUnavailable": "Le service des agents est indisponible."
  },
  "devTools": {
    "targetChanged": "L’onglet a changé avant l’ouverture des outils de développement.",
    "conditionsPending": "Les conditions de requête sont encore en cours d’application. Attendez la fin avant d’ouvrir les outils de développement.",
    "conditionsChanged": "Les conditions de requête ont changé avant l’ouverture des outils de développement."
  },
  "bookmarks": {
    "invalidUrl": "L’adresse du favori doit être une adresse HTTP ou HTTPS de 4096 caractères encodés au maximum.",
    "limit": "Limite de favoris atteinte ({max}).",
    "duplicate": "Cette adresse est déjà dans les favoris.",
    "unavailable": "Le favori n’est plus disponible.",
    "collectionLimit": "Limite de collections atteinte (50).",
    "collectionMissing": "Collection de favoris introuvable.",
    "collectionNameTaken": "Une collection de favoris portant ce nom existe déjà.",
    "collectionName": "Le nom de la collection doit contenir entre 1 et 80 caractères.",
    "storageUnavailable": "Le stockage des favoris est indisponible.",
    "historyUnavailable": "L’historique des visites est indisponible."
  },
  "startupScreen": {
    "title": "Hronaut n’a pas pu démarrer",
    "description": "L’interface de l’application n’a pas pu charger ses paramètres initiaux.",
    "retry": "Réessayer",
    "privacy": "Votre profil de navigateur reste sur cet appareil.",
    "settingsUnavailable": "Le service de paramètres de l’interface est indisponible."
  }
}

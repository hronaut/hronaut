export const frFRTrustedDialogs = {
  close: 'Fermer',
  httpAuth: {
    eyebrow: 'Connexion',
    headline: 'Se connecter à {origin}',
    notPrivate: 'Votre connexion à ce site n’est pas privée. N’importe qui sur le réseau peut lire votre nom d’utilisateur et votre mot de passe.',
    workspace: 'Vous restez connecté à ce site dans l’espace de travail « {workspace} » jusqu’à ce que Hronaut se ferme.',
    sent: 'Hronaut envoie votre nom d’utilisateur et votre mot de passe uniquement à ce site et ne les montre jamais aux agents.',
    username: 'Nom d’utilisateur',
    password: 'Mot de passe',
    signIn: 'Se connecter'
  },
  certificate: {
    eyebrow: 'Connexion non privée',
    headline: 'Continuer vers {host} ?',
    authority: 'Son certificat de sécurité ne provient pas d’une autorité approuvée par cet ordinateur.',
    name: 'Son certificat de sécurité concerne un autre site.',
    date: 'Son certificat de sécurité a expiré ou n’est pas encore valide.',
    other: 'Son certificat de sécurité ne peut pas être vérifié.',
    risk: 'Quelqu’un sur le réseau se fait peut-être passer pour ce site afin de lire ce que vous lui envoyez, comme vos mots de passe.',
    workspace: 'Hronaut fait confiance à ce certificat pour ce site dans l’espace de travail « {workspace} » jusqu’à ce que Hronaut se ferme, et les agents de l’espace de travail peuvent aussi l’ouvrir.',
    session: 'Hronaut fait confiance à ce certificat pour ce site jusqu’à ce que Hronaut se ferme.',
    back: 'Revenir en lieu sûr',
    proceed: 'Continuer (dangereux)'
  },
  savePassword: {
    eyebrow: 'Mots de passe enregistrés',
    save: 'Enregistrer votre mot de passe pour {origin} ?',
    update: 'Mettre à jour le mot de passe enregistré pour {origin} ?',
    username: 'Nom d’utilisateur',
    noUsername: 'La page n’a envoyé aucun nom d’utilisateur.',
    stored: 'Hronaut le chiffre avec le stockage sécurisé du système d’exploitation. Les mots de passe enregistrés ne sont jamais exposés via MCP.'
  },
  walletRecovery: {
    eyebrow: 'Nouveau portefeuille',
    headline: 'Notez la phrase de récupération de {wallet}',
    phrase: 'Phrase de récupération',
    keep: 'Notez ces mots dans l’ordre et conservez-les hors ligne. Quiconque les possède contrôle le portefeuille.',
    added: 'Hronaut ajoute le portefeuille dès que vous confirmez les avoir notés.'
  },
  claudeSetup: {
    file: 'Fichier',
    added: 'Nouvelle entrée dans "mcpServers"',
    replaces: 'Entrée qu’elle remplace'
  },
  sitePermission: {
    embeddedIn: 'Intégré dans {site}',
    wants: {
      camera: '{origin} souhaite utiliser votre caméra',
      microphone: '{origin} souhaite utiliser votre micro',
      cameraAndMicrophone: '{origin} souhaite utiliser votre caméra et votre micro',
      geolocation: '{origin} souhaite connaître votre position',
      notifications: '{origin} souhaite afficher des notifications',
      clipboardRead: '{origin} souhaite voir le texte et les images que vous copiez',
      midiSysex: '{origin} souhaite contrôler et reprogrammer vos appareils MIDI',
      midi: '{origin} souhaite utiliser vos appareils MIDI',
      localFonts: '{origin} souhaite utiliser les polices de votre ordinateur',
      localNetwork: '{origin} souhaite rechercher les appareils de votre réseau local et s’y connecter',
      loopbackNetwork: '{origin} souhaite se connecter aux applications et services de cet appareil',
      fileSystem: '{origin} souhaite utiliser un fichier ou un dossier de votre ordinateur',
      openExternal: '{origin} souhaite ouvrir une application de votre ordinateur',
      idleDetection: '{origin} souhaite savoir quand vous utilisez cet appareil',
      keyboardLock: '{origin} souhaite intercepter vos raccourcis clavier',
      pointerLock: '{origin} souhaite verrouiller et masquer le pointeur de votre souris',
      windowManagement: '{origin} souhaite gérer les fenêtres sur tous vos écrans',
      displayCapture: '{origin} souhaite voir votre écran',
      other: '{origin} souhaite utiliser « {permission} »'
    }
  }
}

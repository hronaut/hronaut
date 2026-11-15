export const frFRRemoteConnections = {
  label: 'Autoriser les connexions depuis d’autres ordinateurs',
  description: 'Écouter sur toutes les interfaces réseau IPv4. L’authentification par jeton est facultative. Sans elle, toute personne pouvant atteindre cet écouteur peut contrôler votre navigateur et joindre des fichiers locaux.',
  restart: 'Redémarrez Hronaut après avoir modifié l’accès à distance. Les modifications de l’authentification s’appliquent immédiatement.',
  connection: 'Sur l’autre ordinateur, utilisez http://this-computer-LAN-IP:{port}/mcp et, si l’authentification est activée, un identifiant bearer issu des Profils de capacités ci-dessous. Autorisez ce port dans votre pare-feu. Utilisez uniquement un réseau de confiance : HTTP ne chiffre pas le trafic.'
}

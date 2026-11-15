export const frFRHomeReadiness = {
  heading: 'État de préparation MCP',
  description: 'Vérifiez chaque maillon séparément avant de vous fier aux outils du navigateur.',
  checks: {
    app: 'Application',
    endpoint: 'Point d’accès local',
    initialization: 'Initialisation du client',
    advertisedTools: 'Outils annoncés',
    configuration: 'Configuration du client',
    clientVisibility: 'Outils visibles dans le client actif',
    probe: 'Sonde en lecture seule'
  },
  inventory: 'Collez la liste d’outils affichée par le client actif',
  inventoryPlaceholder: 'Collez la sortie du client contenant des noms d’outils browser_* ou wallet_*',
  verifyInventory: 'Comparer la liste d’outils',
  copyReport: 'Copier le diagnostic',
  reportLabel: 'Diagnostic de préparation MCP sûr à copier',
  privacy: 'La comparaison reste sur cette page. Le rapport copié contient uniquement des états typés, des décomptes, des noms d’outils limités et des horodatages.',
  nextAction: {
    start_honaut: 'Démarrez ou réparez l’écouteur local de Hronaut.',
    connect_client: 'Reconnectez le client MCP actif et attendez son initialisation.',
    verify_client_configuration: 'Confirmez ce point d’accès et l’authentification dans la configuration du client actif.',
    list_tools_in_active_client: 'Listez les outils dans le client actif et comparez-les ici.',
    run_read_only_probe: 'Dans un espace de travail propre à la tâche, appelez une fois browser_status ou browser_snapshot.',
    retry_read_only_probe: 'Examinez l’erreur du client actif, puis relancez une sonde en lecture seule.',
    none: 'Aucune action nécessaire pour cette vérification.'
  }
}

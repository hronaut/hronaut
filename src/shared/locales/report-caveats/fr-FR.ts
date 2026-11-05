export const frFRReportCaveats = {
  performance: {
    lcpPhases: 'Les phases du LCP sont des mesures de temps du navigateur, pas une preuve de cause. Les données manquantes ou restreintes sont signalées ; l’attribution des phases après une restauration ou une navigation douce n’est pas prise en charge.',
    localSample: 'Il s’agit d’un seul échantillon local de la visite en cours, et non de données terrain ni d’un résultat CrUX au 75e centile.',
    inpUnavailable: 'L’INP reste indisponible tant que la page n’a pas reçu d’interaction prise en compte ; certaines métriques sont indisponibles pour les visites en arrière-plan ou très courtes.',
    longAnimationFrames: 'L’attribution des longues images d’animation désigne les points d’entrée des scripts, pas forcément la fonction interne la plus lente.',
    crossOrigin: 'Les cadres d’autres origines, les workers, les service workers et le code des mondes isolés peuvent effectuer du travail sans être attribués à un script.',
    userTimings: 'Les noms de chronométrage utilisateur sont définis par la page et nettoyés ; les objets de détail arbitraires, les piles d’appels et le code source sont omis.',
    layoutShifts: 'Les décalages de mise en page survenus juste après une saisie sont exclus. La somme de leurs scores sert au diagnostic et peut différer du CLS calculé par fenêtres de session.',
    baselineUrl: 'L’adresse de la référence diffère de cette mesure ; ne comparez que si le changement de navigation était voulu.',
    environment: 'L’environnement du navigateur diffère de la référence ; un changement de zone d’affichage, de ralentissement, de cache, d’en-têtes ou de langue peut influer sur l’écart.',
    deltas: 'Les écarts avant et après comparent deux échantillons locaux et peuvent inclure la variation normale d’une exécution à l’autre ; répétez les mesures importantes dans les mêmes conditions.'
  },
  accessibilityComparison: {
    urlChanged: 'L’adresse de la page a changé depuis la référence d’accessibilité.',
    scopeChanged: 'La norme, le sélecteur ou les limites de collecte de l’audit ont changé ; définissez une nouvelle référence pour cette portée.',
    engineChanged: 'Le moteur d’audit a changé ; définissez une nouvelle référence avant de comparer les constats.',
    baselineTruncated: 'La référence a été tronquée : les nouveaux constats ne peuvent pas être déterminés de façon fiable.',
    currentTruncated: 'L’audit actuel a été tronqué : les constats résolus ne peuvent pas être déterminés de façon fiable.'
  },
  indexedDb: {
    origin: 'Seule cette origine de premier niveau est couverte ; les bases de données des cadres tiers ne sont pas incluses.',
    snapshot: 'Les bases de données et les enregistrements sont un instantané. Actualisez après une modification d’IndexedDB par le site.',
    names: 'Les noms des bases de données, magasins d’objets, index et clés sont définis par le site et peuvent eux-mêmes contenir des données privées.',
    longNames: 'Les bases de données et magasins d’objets dont le nom dépasse 512 caractères sont omis.',
    valuesIncluded: 'Les aperçus des enregistrements sont limités et peuvent contenir des données privées de l’application.',
    valuesOmitted: 'Les valeurs des enregistrements sont omises.',
    readOnly: 'Cet inspecteur lit seulement IndexedDB, sans jamais le modifier ni l’effacer.'
  },
  storageUsage: {
    estimates: 'L’utilisation et le quota sont des estimations ponctuelles du navigateur et peuvent changer quand Chromium évince ou écrit des données.',
    quota: 'Le quota est le budget que Chromium indique actuellement pour cette origine, pas l’espace libre de l’appareil.',
    origin: 'Seule cette origine HTTP(S) de premier niveau est couverte ; le stockage tiers et partitionné peut être comptabilisé séparément.',
    aggregates: 'Seuls les totaux en octets et les catégories de stockage du navigateur sont affichés. Les clés, valeurs, noms de fichiers et corps de réponse ne sont jamais inclus.',
    readOnly: 'Cet inspecteur lit seulement l’utilisation du stockage, sans jamais modifier ni effacer de données.',
    fallback: 'La répartition détaillée du quota de Chromium n’était pas disponible ; ce rapport utilise donc l’estimation globale du navigateur : {reason}'
  },
  storageChanges: {
    baseline: 'L’état de référence reste uniquement en mémoire et est supprimé quand vous l’effacez, quand l’onglet change d’origine ou se ferme, ou quand Hronaut se ferme.',
    scope: 'Le stockage local et les cookies sont partagés par origine dans cet espace de travail et isolés des autres espaces de travail ; le stockage de session n’appartient qu’à cet onglet.',
    valuesIncluded: 'Les valeurs sont affichées jusqu’à une taille limite. Les valeurs des cookies HttpOnly restent toujours protégées.',
    valuesOmitted: 'Les valeurs sont omises.',
    snapshot: 'L’instantané couvre les 200 premières entrées triées de chaque type de stockage. Le stockage peut aussi changer en arrière-plan entre l’état de référence et la comparaison.'
  },
  pwa: {
    origin: 'Seule cette origine de premier niveau est couverte ; les workers et caches des cadres tiers ne sont pas inclus.',
    snapshot: 'Les enregistrements et les entrées en cache sont un instantané. Actualisez après une modification de l’état hors ligne par le site.',
    manifest: 'Le manifeste est lu dans quelques champs limités ; sa source brute n’est jamais affichée.',
    installabilityIds: 'Les identifiants d’erreurs d’installabilité viennent de Chromium et peuvent changer d’une version de Chromium à l’autre.',
    readOnly: 'Cet inspecteur lit seulement les données hors ligne et n’affiche jamais les corps de réponse en cache.',
    headersIncluded: 'Les en-têtes de requête et de réponse sont affichés jusqu’à une limite ; les en-têtes reconnus comme contenant des secrets sont masqués.',
    headersOmitted: 'Les valeurs des en-têtes sont omises.',
    opaqueSizes: 'La taille des réponses opaques peut inclure le remplissage de quota du navigateur et n’est pas mesurée ici.',
    clearing: 'Cet inspecteur ne désinscrit jamais de workers et ne vide jamais de caches.',
    installabilityUnavailable: 'Les diagnostics d’installabilité n’étaient pas disponibles : {reason}'
  }
}

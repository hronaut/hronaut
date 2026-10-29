export const homeReadinessMessages = {
  'en-US': {
    heading: 'MCP readiness',
    description: 'Verify each boundary separately before relying on browser tools.',
    checks: {
      app: 'Application',
      endpoint: 'Local endpoint',
      initialization: 'Client initialization',
      advertisedTools: 'Advertised tools',
      configuration: 'Client configuration',
      clientVisibility: 'Tools visible in active client',
      probe: 'Read-only probe'
    },
    inventory: 'Paste the tool list shown by the active client',
    inventoryPlaceholder: 'Paste client output containing browser_* or wallet_* tool names',
    verifyInventory: 'Compare tool list',
    copyReport: 'Copy diagnostic',
    reportLabel: 'Copy-safe MCP readiness diagnostic',
    privacy: 'Comparison stays on this page. The copied report contains only typed states, counts, bounded tool names, and timestamps.',
    nextAction: {
      start_honaut: 'Start or repair the local Hronaut listener.',
      connect_client: 'Reconnect the active MCP client and wait for initialization.',
      verify_client_configuration: 'Confirm this endpoint and authentication in the active client configuration.',
      list_tools_in_active_client: 'List tools in the active client and compare them here.',
      run_read_only_probe: 'In a task-owned workspace, invoke browser_status or browser_snapshot once.',
      retry_read_only_probe: 'Inspect the active client error, then retry one read-only probe.',
      none: 'No action needed for this check.'
    }
  },
  'uk-UA': {
    heading: 'Готовність MCP',
    description: 'Перевірте кожну ланку окремо, перш ніж покладатися на інструменти браузера.',
    checks: {
      app: 'Застосунок',
      endpoint: 'Локальна кінцева точка',
      initialization: 'Ініціалізація клієнта',
      advertisedTools: 'Оголошені інструменти',
      configuration: 'Конфігурація клієнта',
      clientVisibility: 'Інструменти, видимі в активному клієнті',
      probe: 'Пробний виклик лише для читання'
    },
    inventory: 'Вставте список інструментів, який показує активний клієнт',
    inventoryPlaceholder: 'Вставте вивід клієнта з назвами інструментів browser_* або wallet_*',
    verifyInventory: 'Порівняти список інструментів',
    copyReport: 'Копіювати діагностику',
    reportLabel: 'Діагностика готовності MCP, безпечна для копіювання',
    privacy: 'Порівняння не виходить за межі цієї сторінки. Скопійований звіт містить лише типізовані стани, лічильники, обмежений набір назв інструментів і позначки часу.',
    nextAction: {
      start_honaut: 'Запустіть або відновіть локальний слухач Hronaut.',
      connect_client: 'Знову підключіть активний MCP-клієнт і дочекайтеся ініціалізації.',
      verify_client_configuration: 'Перевірте цю кінцеву точку й автентифікацію в конфігурації активного клієнта.',
      list_tools_in_active_client: 'Виведіть список інструментів в активному клієнті й порівняйте його тут.',
      run_read_only_probe: 'У робочому просторі, що належить завданню, один раз викличте browser_status або browser_snapshot.',
      retry_read_only_probe: 'Перегляньте помилку активного клієнта, а потім повторіть один пробний виклик лише для читання.',
      none: 'Для цієї перевірки дії не потрібні.'
    }
  },
  'ru-RU': {
    heading: 'Готовность MCP',
    description: 'Проверьте каждое звено отдельно, прежде чем полагаться на инструменты браузера.',
    checks: {
      app: 'Приложение',
      endpoint: 'Локальная конечная точка',
      initialization: 'Инициализация клиента',
      advertisedTools: 'Объявленные инструменты',
      configuration: 'Конфигурация клиента',
      clientVisibility: 'Инструменты, видимые в активном клиенте',
      probe: 'Пробный вызов только для чтения'
    },
    inventory: 'Вставьте список инструментов, показанный активным клиентом',
    inventoryPlaceholder: 'Вставьте вывод клиента с именами инструментов browser_* или wallet_*',
    verifyInventory: 'Сравнить список инструментов',
    copyReport: 'Копировать диагностику',
    reportLabel: 'Диагностика готовности MCP, безопасная для копирования',
    privacy: 'Сравнение остаётся на этой странице. Скопированный отчёт содержит только типизированные состояния, количества, ограниченный набор имён инструментов и отметки времени.',
    nextAction: {
      start_honaut: 'Запустите или восстановите локальный прослушиватель Hronaut.',
      connect_client: 'Переподключите активный клиент MCP и дождитесь инициализации.',
      verify_client_configuration: 'Убедитесь, что в конфигурации активного клиента указаны эта конечная точка и аутентификация.',
      list_tools_in_active_client: 'Выведите список инструментов в активном клиенте и сравните его здесь.',
      run_read_only_probe: 'В рабочем пространстве, принадлежащем задаче, один раз вызовите browser_status или browser_snapshot.',
      retry_read_only_probe: 'Изучите ошибку активного клиента, затем повторите один пробный вызов только для чтения.',
      none: 'Для этой проверки действий не требуется.'
    }
  },
  'de-DE': {
    heading: 'MCP-Bereitschaft',
    description: 'Prüfen Sie jede Stufe einzeln, bevor Sie sich auf Browserwerkzeuge verlassen.',
    checks: {
      app: 'Anwendung',
      endpoint: 'Lokaler Endpunkt',
      initialization: 'Client-Initialisierung',
      advertisedTools: 'Angebotene Werkzeuge',
      configuration: 'Client-Konfiguration',
      clientVisibility: 'Werkzeuge im aktiven Client sichtbar',
      probe: 'Nur-Lese-Testaufruf'
    },
    inventory: 'Fügen Sie die vom aktiven Client angezeigte Werkzeugliste ein',
    inventoryPlaceholder: 'Client-Ausgabe mit browser_*- oder wallet_*-Werkzeugnamen einfügen',
    verifyInventory: 'Werkzeugliste vergleichen',
    copyReport: 'Diagnose kopieren',
    reportLabel: 'Sicher kopierbare MCP-Bereitschaftsdiagnose',
    privacy: 'Der Vergleich bleibt auf dieser Seite. Der kopierte Bericht enthält nur typisierte Zustände, Anzahlen, begrenzte Werkzeugnamen und Zeitstempel.',
    nextAction: {
      start_honaut: 'Starten oder reparieren Sie den lokalen Hronaut-Listener.',
      connect_client: 'Verbinden Sie den aktiven MCP-Client erneut und warten Sie auf die Initialisierung.',
      verify_client_configuration: 'Bestätigen Sie diesen Endpunkt und die Authentifizierung in der Konfiguration des aktiven Clients.',
      list_tools_in_active_client: 'Listen Sie die Werkzeuge im aktiven Client auf und vergleichen Sie sie hier.',
      run_read_only_probe: 'Rufen Sie in einem aufgabeneigenen Arbeitsbereich einmal browser_status oder browser_snapshot auf.',
      retry_read_only_probe: 'Prüfen Sie den Fehler im aktiven Client und wiederholen Sie dann einen Nur-Lese-Testaufruf.',
      none: 'Für diese Prüfung ist keine Aktion erforderlich.'
    }
  },
  'fr-FR': {
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
  },
  'es-ES': {
    heading: 'Preparación de MCP',
    description: 'Comprueba cada límite por separado antes de confiar en las herramientas del navegador.',
    checks: {
      app: 'Aplicación',
      endpoint: 'Punto de acceso local',
      initialization: 'Inicialización del cliente',
      advertisedTools: 'Herramientas anunciadas',
      configuration: 'Configuración del cliente',
      clientVisibility: 'Herramientas visibles en el cliente activo',
      probe: 'Sondeo de solo lectura'
    },
    inventory: 'Pega la lista de herramientas que muestra el cliente activo',
    inventoryPlaceholder: 'Pega la salida del cliente con nombres de herramientas browser_* o wallet_*',
    verifyInventory: 'Comparar lista de herramientas',
    copyReport: 'Copiar diagnóstico',
    reportLabel: 'Diagnóstico de preparación de MCP seguro para copiar',
    privacy: 'La comparación no sale de esta página. El informe copiado solo contiene estados tipados, recuentos, nombres de herramientas acotados y marcas de tiempo.',
    nextAction: {
      start_honaut: 'Inicia o repara el servidor local de Hronaut.',
      connect_client: 'Vuelve a conectar el cliente MCP activo y espera a que se inicialice.',
      verify_client_configuration: 'Confirma este punto de acceso y la autenticación en la configuración del cliente activo.',
      list_tools_in_active_client: 'Lista las herramientas en el cliente activo y compáralas aquí.',
      run_read_only_probe: 'En un espacio de trabajo propio de la tarea, invoca browser_status o browser_snapshot una vez.',
      retry_read_only_probe: 'Revisa el error del cliente activo y vuelve a intentar un sondeo de solo lectura.',
      none: 'Esta comprobación no requiere ninguna acción.'
    }
  },
  'pl-PL': {
    heading: 'Gotowość MCP',
    description: 'Zanim zaczniesz polegać na narzędziach przeglądarki, sprawdź osobno każdą warstwę.',
    checks: {
      app: 'Aplikacja',
      endpoint: 'Lokalny punkt końcowy',
      initialization: 'Inicjalizacja klienta',
      advertisedTools: 'Udostępniane narzędzia',
      configuration: 'Konfiguracja klienta',
      clientVisibility: 'Narzędzia widoczne w aktywnym kliencie',
      probe: 'Test tylko do odczytu'
    },
    inventory: 'Wklej listę narzędzi pokazaną przez aktywnego klienta',
    inventoryPlaceholder: 'Wklej dane wyjściowe klienta zawierające nazwy narzędzi browser_* lub wallet_*',
    verifyInventory: 'Porównaj listę narzędzi',
    copyReport: 'Kopiuj diagnostykę',
    reportLabel: 'Diagnostyka gotowości MCP bezpieczna do skopiowania',
    privacy: 'Porównanie pozostaje na tej stronie. Skopiowany raport zawiera tylko typowane stany, liczniki, ograniczone nazwy narzędzi i znaczniki czasu.',
    nextAction: {
      start_honaut: 'Uruchom lub napraw lokalny serwer nasłuchujący Hronaut.',
      connect_client: 'Połącz ponownie aktywnego klienta MCP i poczekaj na inicjalizację.',
      verify_client_configuration: 'Potwierdź ten punkt końcowy i uwierzytelnianie w konfiguracji aktywnego klienta.',
      list_tools_in_active_client: 'Wyświetl listę narzędzi w aktywnym kliencie i porównaj ją tutaj.',
      run_read_only_probe: 'W obszarze roboczym należącym do zadania wywołaj raz browser_status lub browser_snapshot.',
      retry_read_only_probe: 'Sprawdź błąd aktywnego klienta, a następnie ponów jeden test tylko do odczytu.',
      none: 'Ta kontrola nie wymaga żadnych działań.'
    }
  },
  'it-IT': {
    heading: 'Stato di preparazione MCP',
    description: 'Verifica separatamente ogni passaggio prima di affidarti agli strumenti del browser.',
    checks: {
      app: 'Applicazione',
      endpoint: 'Endpoint locale',
      initialization: 'Inizializzazione del client',
      advertisedTools: 'Strumenti annunciati',
      configuration: 'Configurazione del client',
      clientVisibility: 'Strumenti visibili nel client attivo',
      probe: 'Verifica in sola lettura'
    },
    inventory: 'Incolla l’elenco degli strumenti mostrato dal client attivo',
    inventoryPlaceholder: 'Incolla l’output del client contenente nomi di strumenti browser_* o wallet_*',
    verifyInventory: 'Confronta elenco strumenti',
    copyReport: 'Copia diagnostica',
    reportLabel: 'Diagnostica di preparazione MCP sicura da copiare',
    privacy: 'Il confronto resta su questa pagina. Il report copiato contiene solo stati tipizzati, conteggi, nomi di strumenti limitati e timestamp.',
    nextAction: {
      start_honaut: 'Avvia o ripara il listener locale di Hronaut.',
      connect_client: 'Riconnetti il client MCP attivo e attendi l’inizializzazione.',
      verify_client_configuration: 'Verifica questo endpoint e l’autenticazione nella configurazione del client attivo.',
      list_tools_in_active_client: 'Elenca gli strumenti nel client attivo e confrontali qui.',
      run_read_only_probe: 'In un’area di lavoro di proprietà dell’attività, richiama una volta browser_status o browser_snapshot.',
      retry_read_only_probe: 'Esamina l’errore del client attivo, quindi ripeti una verifica in sola lettura.',
      none: 'Nessuna azione necessaria per questo controllo.'
    }
  },
  'pt-BR': {
    heading: 'Prontidão do MCP',
    description: 'Verifique cada limite separadamente antes de contar com as ferramentas do navegador.',
    checks: {
      app: 'Aplicativo',
      endpoint: 'Endpoint local',
      initialization: 'Inicialização do cliente',
      advertisedTools: 'Ferramentas anunciadas',
      configuration: 'Configuração do cliente',
      clientVisibility: 'Ferramentas visíveis no cliente ativo',
      probe: 'Teste somente leitura'
    },
    inventory: 'Cole a lista de ferramentas mostrada pelo cliente ativo',
    inventoryPlaceholder: 'Cole a saída do cliente com nomes de ferramentas browser_* ou wallet_*',
    verifyInventory: 'Comparar lista de ferramentas',
    copyReport: 'Copiar diagnóstico',
    reportLabel: 'Diagnóstico de prontidão do MCP seguro para copiar',
    privacy: 'A comparação fica nesta página. O relatório copiado contém somente estados tipados, contagens, nomes de ferramentas limitados e carimbos de data/hora.',
    nextAction: {
      start_honaut: 'Inicie ou repare o listener local do Hronaut.',
      connect_client: 'Reconecte o cliente MCP ativo e aguarde a inicialização.',
      verify_client_configuration: 'Confirme este endpoint e a autenticação na configuração do cliente ativo.',
      list_tools_in_active_client: 'Liste as ferramentas no cliente ativo e compare-as aqui.',
      run_read_only_probe: 'Em um espaço de trabalho da tarefa, invoque browser_status ou browser_snapshot uma vez.',
      retry_read_only_probe: 'Inspecione o erro do cliente ativo e tente novamente um teste somente leitura.',
      none: 'Nenhuma ação necessária para esta verificação.'
    }
  },
  'tr-TR': {
    heading: 'MCP hazırlığı',
    description: 'Tarayıcı araçlarına güvenmeden önce her sınırı ayrı ayrı doğrulayın.',
    checks: {
      app: 'Uygulama',
      endpoint: 'Yerel uç nokta',
      initialization: 'İstemci başlatma',
      advertisedTools: 'Duyurulan araçlar',
      configuration: 'İstemci yapılandırması',
      clientVisibility: 'Etkin istemcide görünen araçlar',
      probe: 'Salt okunur yoklama'
    },
    inventory: 'Etkin istemcinin gösterdiği araç listesini yapıştırın',
    inventoryPlaceholder: 'browser_* veya wallet_* araç adlarını içeren istemci çıktısını yapıştırın',
    verifyInventory: 'Araç listesini karşılaştır',
    copyReport: 'Tanılamayı kopyala',
    reportLabel: 'Kopyalaması güvenli MCP hazırlık tanılaması',
    privacy: 'Karşılaştırma bu sayfada kalır. Kopyalanan rapor yalnızca türlendirilmiş durumları, sayıları, sınırlı sayıda araç adını ve zaman damgalarını içerir.',
    nextAction: {
      start_honaut: 'Yerel Hronaut dinleyicisini başlatın veya onarın.',
      connect_client: 'Etkin MCP istemcisini yeniden bağlayın ve başlatmanın tamamlanmasını bekleyin.',
      verify_client_configuration: 'Etkin istemcinin yapılandırmasında bu uç noktayı ve kimlik doğrulamayı onaylayın.',
      list_tools_in_active_client: 'Etkin istemcideki araçları listeleyin ve burada karşılaştırın.',
      run_read_only_probe: 'Göreve ait bir çalışma alanında browser_status veya browser_snapshot aracını bir kez çağırın.',
      retry_read_only_probe: 'Etkin istemcideki hatayı inceleyin, ardından salt okunur yoklamayı bir kez daha deneyin.',
      none: 'Bu denetim için işlem gerekmiyor.'
    }
  },
  'hi-IN': {
    heading: 'MCP की तैयारी',
    description: 'ब्राउज़र टूल पर भरोसा करने से पहले हर सीमा की अलग-अलग पुष्टि करें।',
    checks: {
      app: 'ऐप्लिकेशन',
      endpoint: 'लोकल एंडपॉइंट',
      initialization: 'क्लाइंट का शुरू होना',
      advertisedTools: 'बताए गए टूल',
      configuration: 'क्लाइंट कॉन्फ़िगरेशन',
      clientVisibility: 'चालू क्लाइंट में दिख रहे टूल',
      probe: 'सिर्फ़ पढ़ने वाली जांच'
    },
    inventory: 'चालू क्लाइंट में दिख रही टूल की सूची चिपकाएं',
    inventoryPlaceholder: 'क्लाइंट का ऐसा आउटपुट चिपकाएं जिसमें browser_* या wallet_* टूल के नाम हों',
    verifyInventory: 'टूल की सूची की तुलना करें',
    copyReport: 'डायग्नोस्टिक कॉपी करें',
    reportLabel: 'कॉपी करने के लिए सुरक्षित MCP तैयारी डायग्नोस्टिक',
    privacy: 'तुलना इसी पेज पर रहती है। कॉपी की गई रिपोर्ट में सिर्फ़ तय स्थितियां, संख्याएं, सीमित टूल नाम और टाइमस्टैंप होते हैं।',
    nextAction: {
      start_honaut: 'लोकल Hronaut लिसनर शुरू करें या ठीक करें।',
      connect_client: 'चालू MCP क्लाइंट को फिर से कनेक्ट करें और उसके शुरू होने का इंतज़ार करें।',
      verify_client_configuration: 'चालू क्लाइंट के कॉन्फ़िगरेशन में इस एंडपॉइंट और ऑथेंटिकेशन की पुष्टि करें।',
      list_tools_in_active_client: 'चालू क्लाइंट में टूल की सूची देखें और यहां उनकी तुलना करें।',
      run_read_only_probe: 'टास्क के अपने वर्कस्पेस में, browser_status या browser_snapshot को एक बार चलाएं।',
      retry_read_only_probe: 'चालू क्लाइंट की गड़बड़ी जांचें, फिर सिर्फ़ पढ़ने वाली एक जांच दोबारा चलाएं।',
      none: 'इस जांच के लिए कोई कार्रवाई ज़रूरी नहीं है।'
    }
  },
  'ja-JP': {
    heading: 'MCP の準備状況',
    description: 'ブラウザ ツールを利用する前に、各境界を個別に確認してください。',
    checks: {
      app: 'アプリケーション',
      endpoint: 'ローカル エンドポイント',
      initialization: 'クライアントの初期化',
      advertisedTools: '公開されているツール',
      configuration: 'クライアントの設定',
      clientVisibility: 'アクティブなクライアントで表示されるツール',
      probe: '読み取り専用のプローブ'
    },
    inventory: 'アクティブなクライアントに表示されているツールの一覧を貼り付けてください',
    inventoryPlaceholder: 'browser_* または wallet_* のツール名を含むクライアントの出力を貼り付けます',
    verifyInventory: 'ツールの一覧を比較',
    copyReport: '診断情報をコピー',
    reportLabel: 'コピーしても安全な MCP 準備状況の診断情報',
    privacy: '比較はこのページ内で行われます。コピーされるレポートには、型付きの状態、件数、範囲を限定したツール名、タイムスタンプのみが含まれます。',
    nextAction: {
      start_honaut: 'ローカルの Hronaut リスナーを起動または修復してください。',
      connect_client: 'アクティブな MCP クライアントを再接続し、初期化が完了するまでお待ちください。',
      verify_client_configuration: 'アクティブなクライアントの設定で、このエンドポイントと認証を確認してください。',
      list_tools_in_active_client: 'アクティブなクライアントでツールを一覧表示し、ここで比較してください。',
      run_read_only_probe: 'タスク専用のワークスペースで、browser_status または browser_snapshot を 1 回呼び出してください。',
      retry_read_only_probe: 'アクティブなクライアントのエラーを確認してから、読み取り専用のプローブを 1 回再試行してください。',
      none: 'このチェックで必要な操作はありません。'
    }
  },
  'ko-KR': {
    heading: 'MCP 준비 상태',
    description: '브라우저 도구를 사용하기 전에 각 경계를 하나씩 확인하세요.',
    checks: {
      app: '애플리케이션',
      endpoint: '로컬 엔드포인트',
      initialization: '클라이언트 초기화',
      advertisedTools: '제공되는 도구',
      configuration: '클라이언트 구성',
      clientVisibility: '활성 클라이언트에 표시되는 도구',
      probe: '읽기 전용 점검'
    },
    inventory: '활성 클라이언트에 표시된 도구 목록을 붙여넣으세요',
    inventoryPlaceholder: 'browser_* 또는 wallet_* 도구 이름이 포함된 클라이언트 출력을 붙여넣으세요',
    verifyInventory: '도구 목록 비교',
    copyReport: '진단 정보 복사',
    reportLabel: '복사해도 안전한 MCP 준비 상태 진단',
    privacy: '비교는 이 페이지 안에서만 이루어집니다. 복사된 보고서에는 정해진 상태 값, 개수, 길이가 제한된 도구 이름, 타임스탬프만 포함됩니다.',
    nextAction: {
      start_honaut: '로컬 Hronaut 리스너를 시작하거나 복구하세요.',
      connect_client: '활성 MCP 클라이언트를 다시 연결하고 초기화가 끝날 때까지 기다리세요.',
      verify_client_configuration: '활성 클라이언트 구성에서 이 엔드포인트와 인증을 확인하세요.',
      list_tools_in_active_client: '활성 클라이언트에서 도구 목록을 표시한 후 여기에서 비교하세요.',
      run_read_only_probe: '태스크가 소유한 작업 공간에서 browser_status 또는 browser_snapshot을 한 번 호출하세요.',
      retry_read_only_probe: '활성 클라이언트의 오류를 확인한 후 읽기 전용 점검을 한 번 다시 시도하세요.',
      none: '이 항목은 조치가 필요하지 않습니다.'
    }
  },
  'zh-CN': {
    heading: 'MCP 就绪状态',
    description: '在依赖浏览器工具之前，请逐一验证每个环节。',
    checks: {
      app: '应用',
      endpoint: '本地端点',
      initialization: '客户端初始化',
      advertisedTools: '公布的工具',
      configuration: '客户端配置',
      clientVisibility: '活动客户端中可见的工具',
      probe: '只读探测'
    },
    inventory: '粘贴活动客户端显示的工具列表',
    inventoryPlaceholder: '粘贴包含 browser_* 或 wallet_* 工具名称的客户端输出',
    verifyInventory: '比较工具列表',
    copyReport: '复制诊断信息',
    reportLabel: '可安全复制的 MCP 就绪诊断信息',
    privacy: '比较仅在此页面上进行。复制的报告仅包含类型化状态、计数、有限的工具名称和时间戳。',
    nextAction: {
      start_honaut: '启动或修复本地 Hronaut 监听器。',
      connect_client: '重新连接活动的 MCP 客户端，并等待初始化完成。',
      verify_client_configuration: '在活动客户端的配置中确认此端点和身份验证设置。',
      list_tools_in_active_client: '在活动客户端中列出工具，然后在此处进行比较。',
      run_read_only_probe: '在任务专属的工作区中，调用一次 browser_status 或 browser_snapshot。',
      retry_read_only_probe: '检查活动客户端的错误，然后重试一次只读探测。',
      none: '此检查无需执行任何操作。'
    }
  },
  'zh-TW': {
    heading: 'MCP 就緒狀態',
    description: '在依賴瀏覽器工具之前，請逐一驗證每個環節。',
    checks: {
      app: '應用程式',
      endpoint: '本機端點',
      initialization: '用戶端初始化',
      advertisedTools: '已宣告的工具',
      configuration: '用戶端設定',
      clientVisibility: '使用中用戶端可見的工具',
      probe: '唯讀探測'
    },
    inventory: '貼上使用中用戶端顯示的工具清單',
    inventoryPlaceholder: '貼上包含 browser_* 或 wallet_* 工具名稱的用戶端輸出內容',
    verifyInventory: '比對工具清單',
    copyReport: '複製診斷資訊',
    reportLabel: '可安全複製的 MCP 就緒狀態診斷',
    privacy: '比對只會在這個頁面上進行。複製的報告只包含類型化的狀態、數量、長度受限的工具名稱和時間戳記。',
    nextAction: {
      start_honaut: '啟動或修復本機的 Hronaut 監聽程式。',
      connect_client: '重新連線使用中的 MCP 用戶端，並等待初始化完成。',
      verify_client_configuration: '在使用中用戶端的設定中確認這個端點與驗證方式。',
      list_tools_in_active_client: '在使用中的用戶端列出工具，然後在這裡比對。',
      run_read_only_probe: '在任務專屬的工作區中，呼叫一次 browser_status 或 browser_snapshot。',
      retry_read_only_probe: '檢查使用中用戶端的錯誤，然後再試一次唯讀探測。',
      none: '這項檢查不需要採取任何動作。'
    }
  },
  'id-ID': {
    heading: 'Kesiapan MCP',
    description: 'Verifikasi setiap batas secara terpisah sebelum mengandalkan alat browser.',
    checks: {
      app: 'Aplikasi',
      endpoint: 'Endpoint lokal',
      initialization: 'Inisialisasi klien',
      advertisedTools: 'Alat yang diiklankan',
      configuration: 'Konfigurasi klien',
      clientVisibility: 'Alat terlihat di klien aktif',
      probe: 'Probe hanya baca'
    },
    inventory: 'Tempel daftar alat yang ditampilkan oleh klien aktif',
    inventoryPlaceholder: 'Tempel output klien yang berisi nama alat browser_* atau wallet_*',
    verifyInventory: 'Bandingkan daftar alat',
    copyReport: 'Salin diagnostik',
    reportLabel: 'Diagnostik kesiapan MCP yang aman untuk disalin',
    privacy: 'Perbandingan tetap berada di halaman ini. Laporan yang disalin hanya berisi status bertipe, jumlah, nama alat yang dibatasi, dan stempel waktu.',
    nextAction: {
      start_honaut: 'Mulai atau perbaiki listener Hronaut lokal.',
      connect_client: 'Hubungkan ulang klien MCP aktif dan tunggu inisialisasi selesai.',
      verify_client_configuration: 'Konfirmasi endpoint dan autentikasi ini di konfigurasi klien aktif.',
      list_tools_in_active_client: 'Tampilkan daftar alat di klien aktif dan bandingkan di sini.',
      run_read_only_probe: 'Di ruang kerja milik tugas, panggil browser_status atau browser_snapshot sekali.',
      retry_read_only_probe: 'Periksa error klien aktif, lalu coba lagi satu probe hanya baca.',
      none: 'Tidak ada tindakan yang diperlukan untuk pemeriksaan ini.'
    }
  },
  'vi-VN': {
    heading: 'Mức sẵn sàng của MCP',
    description: 'Hãy xác minh riêng từng ranh giới trước khi dựa vào các công cụ trình duyệt.',
    checks: {
      app: 'Ứng dụng',
      endpoint: 'Điểm cuối cục bộ',
      initialization: 'Khởi tạo ứng dụng khách',
      advertisedTools: 'Công cụ được công bố',
      configuration: 'Cấu hình ứng dụng khách',
      clientVisibility: 'Công cụ hiển thị trong ứng dụng khách đang dùng',
      probe: 'Thăm dò chỉ đọc'
    },
    inventory: 'Dán danh sách công cụ mà ứng dụng khách đang dùng hiển thị',
    inventoryPlaceholder: 'Dán kết quả của ứng dụng khách có chứa tên công cụ browser_* hoặc wallet_*',
    verifyInventory: 'So sánh danh sách công cụ',
    copyReport: 'Sao chép thông tin chẩn đoán',
    reportLabel: 'Thông tin chẩn đoán mức sẵn sàng MCP an toàn để sao chép',
    privacy: 'Việc so sánh chỉ diễn ra trên trang này. Báo cáo được sao chép chỉ chứa các trạng thái đã phân loại, số lượng, tên công cụ có giới hạn và dấu thời gian.',
    nextAction: {
      start_honaut: 'Khởi động hoặc sửa trình nghe Hronaut cục bộ.',
      connect_client: 'Kết nối lại ứng dụng khách MCP đang dùng và đợi quá trình khởi tạo.',
      verify_client_configuration: 'Xác nhận điểm cuối và thông tin xác thực này trong cấu hình của ứng dụng khách đang dùng.',
      list_tools_in_active_client: 'Liệt kê công cụ trong ứng dụng khách đang dùng và so sánh tại đây.',
      run_read_only_probe: 'Trong một không gian làm việc thuộc về nhiệm vụ, hãy gọi browser_status hoặc browser_snapshot một lần.',
      retry_read_only_probe: 'Kiểm tra lỗi của ứng dụng khách đang dùng, rồi thử lại một lượt thăm dò chỉ đọc.',
      none: 'Không cần thao tác nào cho bước kiểm tra này.'
    }
  }
}

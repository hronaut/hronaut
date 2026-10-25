/**
 * The words of Hronaut's own dialogs that main asks through the shell (see `src/shared/trusted-dialogs.ts`). A
 * dialog's buttons, and the lines it shares with the system dialog Hronaut falls back to, stay in `native.dialog`.
 */
export const trustedDialogMessages = {
  'en-US': {
    close: 'Close',
    savePassword: {
      eyebrow: 'Saved passwords',
      save: 'Save your password for {origin}?',
      update: 'Update your saved password for {origin}?',
      username: 'Username',
      noUsername: 'The page sent no username with it.',
      stored: 'Hronaut encrypts it with your operating system’s secure storage. Saved passwords are never exposed through MCP.'
    },
    walletRecovery: {
      eyebrow: 'New wallet',
      headline: 'Write down the recovery phrase for {wallet}',
      phrase: 'Recovery phrase',
      keep: 'Write these words down in order and keep them offline. Anyone who has them controls the wallet.',
      added: 'Hronaut adds the wallet once you confirm you saved them.'
    },
    claudeSetup: {
      file: 'File',
      added: 'New entry in "mcpServers"',
      replaces: 'Entry it replaces'
    },
    sitePermission: {
      embeddedIn: 'Embedded in {site}',
      wants: {
        camera: '{origin} wants to use your camera',
        microphone: '{origin} wants to use your microphone',
        cameraAndMicrophone: '{origin} wants to use your camera and microphone',
        geolocation: '{origin} wants to know your location',
        notifications: '{origin} wants to show notifications',
        clipboardRead: '{origin} wants to see text and images you copy',
        clipboardWrite: '{origin} wants to copy text and images to your clipboard',
        midiSysex: '{origin} wants to control and reprogram your MIDI devices',
        fileSystem: '{origin} wants to use a file or folder on your computer',
        openExternal: '{origin} wants to open an app on your computer',
        fullscreen: '{origin} wants to use the full screen',
        idleDetection: '{origin} wants to know when you are using this device',
        keyboardLock: '{origin} wants to capture your keyboard shortcuts',
        pointerLock: '{origin} wants to lock and hide your mouse pointer',
        persistentStorage: '{origin} wants to store data permanently on this device',
        screenWakeLock: '{origin} wants to keep your screen on',
        storageAccess: '{origin} wants to use its cookies and site data on this page',
        topLevelStorageAccess: '{origin} wants to use cookies and site data of related websites',
        windowManagement: '{origin} wants to manage windows on all your displays',
        displayCapture: '{origin} wants to see your screen',
        other: '{origin} wants to use “{permission}”'
      }
    }
  },
  'uk-UA': {
    close: 'Закрити',
    savePassword: {
      eyebrow: 'Збережені паролі',
      save: 'Зберегти пароль для {origin}?',
      update: 'Оновити збережений пароль для {origin}?',
      username: 'Ім’я користувача',
      noUsername: 'Сторінка не надіслала імені користувача.',
      stored: 'Hronaut шифрує його за допомогою захищеного сховища операційної системи. Збережені паролі ніколи не передаються через MCP.'
    },
    walletRecovery: {
      eyebrow: 'Новий гаманець',
      headline: 'Запишіть фразу відновлення для {wallet}',
      phrase: 'Фраза відновлення',
      keep: 'Запишіть ці слова по порядку й зберігайте їх офлайн. Хто має ці слова, той керує гаманцем.',
      added: 'Hronaut додасть гаманець, щойно ви підтвердите, що зберегли їх.'
    },
    claudeSetup: {
      file: 'Файл',
      added: 'Новий запис у "mcpServers"',
      replaces: 'Запис, який він замінить'
    },
    sitePermission: {
      embeddedIn: 'Вбудовано на {site}',
      wants: {
        camera: 'Сайт {origin} хоче використовувати вашу камеру',
        microphone: 'Сайт {origin} хоче використовувати ваш мікрофон',
        cameraAndMicrophone: 'Сайт {origin} хоче використовувати вашу камеру й мікрофон',
        geolocation: 'Сайт {origin} хоче знати ваше розташування',
        notifications: 'Сайт {origin} хоче показувати сповіщення',
        clipboardRead: 'Сайт {origin} хоче бачити текст і зображення, які ви копіюєте',
        clipboardWrite: 'Сайт {origin} хоче копіювати текст і зображення в буфер обміну',
        midiSysex: 'Сайт {origin} хоче керувати вашими MIDI-пристроями й перепрограмовувати їх',
        fileSystem: 'Сайт {origin} хоче використовувати файл або папку на вашому комп’ютері',
        openExternal: 'Сайт {origin} хоче відкрити застосунок на вашому комп’ютері',
        fullscreen: 'Сайт {origin} хоче перейти в повноекранний режим',
        idleDetection: 'Сайт {origin} хоче знати, коли ви користуєтеся цим пристроєм',
        keyboardLock: 'Сайт {origin} хоче перехоплювати ваші комбінації клавіш',
        pointerLock: 'Сайт {origin} хоче заблокувати й приховати вказівник миші',
        persistentStorage: 'Сайт {origin} хоче назавжди зберігати дані на цьому пристрої',
        screenWakeLock: 'Сайт {origin} хоче не вимикати екран',
        storageAccess: 'Сайт {origin} хоче використовувати свої файли cookie й дані сайту на цій сторінці',
        topLevelStorageAccess: 'Сайт {origin} хоче використовувати файли cookie й дані пов’язаних сайтів',
        windowManagement: 'Сайт {origin} хоче керувати вікнами на всіх ваших екранах',
        displayCapture: 'Сайт {origin} хоче бачити ваш екран',
        other: 'Сайт {origin} хоче використовувати дозвіл «{permission}»'
      }
    }
  },
  'ru-RU': {
    close: 'Закрыть',
    savePassword: {
      eyebrow: 'Сохранённые пароли',
      save: 'Сохранить пароль для {origin}?',
      update: 'Обновить сохранённый пароль для {origin}?',
      username: 'Имя пользователя',
      noUsername: 'Страница не отправила имя пользователя.',
      stored: 'Hronaut шифрует его с помощью защищённого хранилища операционной системы. Сохранённые пароли никогда не передаются через MCP.'
    },
    walletRecovery: {
      eyebrow: 'Новый кошелёк',
      headline: 'Запишите фразу восстановления для {wallet}',
      phrase: 'Фраза восстановления',
      keep: 'Запишите эти слова по порядку и храните их офлайн. У кого эти слова, тот управляет кошельком.',
      added: 'Hronaut добавит кошелёк, как только вы подтвердите, что сохранили их.'
    },
    claudeSetup: {
      file: 'Файл',
      added: 'Новая запись в "mcpServers"',
      replaces: 'Запись, которую она заменит'
    },
    sitePermission: {
      embeddedIn: 'Встроено на {site}',
      wants: {
        camera: 'Сайт {origin} хочет использовать вашу камеру',
        microphone: 'Сайт {origin} хочет использовать ваш микрофон',
        cameraAndMicrophone: 'Сайт {origin} хочет использовать вашу камеру и микрофон',
        geolocation: 'Сайт {origin} хочет знать ваше местоположение',
        notifications: 'Сайт {origin} хочет показывать уведомления',
        clipboardRead: 'Сайт {origin} хочет видеть текст и изображения, которые вы копируете',
        clipboardWrite: 'Сайт {origin} хочет копировать текст и изображения в буфер обмена',
        midiSysex: 'Сайт {origin} хочет управлять вашими MIDI-устройствами и перепрограммировать их',
        fileSystem: 'Сайт {origin} хочет использовать файл или папку на вашем компьютере',
        openExternal: 'Сайт {origin} хочет открыть приложение на вашем компьютере',
        fullscreen: 'Сайт {origin} хочет перейти в полноэкранный режим',
        idleDetection: 'Сайт {origin} хочет знать, когда вы пользуетесь этим устройством',
        keyboardLock: 'Сайт {origin} хочет перехватывать ваши сочетания клавиш',
        pointerLock: 'Сайт {origin} хочет заблокировать и скрыть указатель мыши',
        persistentStorage: 'Сайт {origin} хочет постоянно хранить данные на этом устройстве',
        screenWakeLock: 'Сайт {origin} хочет не выключать экран',
        storageAccess: 'Сайт {origin} хочет использовать свои файлы cookie и данные сайта на этой странице',
        topLevelStorageAccess: 'Сайт {origin} хочет использовать файлы cookie и данные связанных сайтов',
        windowManagement: 'Сайт {origin} хочет управлять окнами на всех ваших экранах',
        displayCapture: 'Сайт {origin} хочет видеть ваш экран',
        other: 'Сайт {origin} хочет использовать разрешение «{permission}»'
      }
    }
  },
  'de-DE': {
    close: 'Schließen',
    savePassword: {
      eyebrow: 'Gespeicherte Passwörter',
      save: 'Passwort für {origin} speichern?',
      update: 'Gespeichertes Passwort für {origin} aktualisieren?',
      username: 'Benutzername',
      noUsername: 'Die Seite hat keinen Benutzernamen mitgesendet.',
      stored: 'Hronaut verschlüsselt es mit dem sicheren Speicher des Betriebssystems. Gespeicherte Passwörter werden niemals über MCP offengelegt.'
    },
    walletRecovery: {
      eyebrow: 'Neue Wallet',
      headline: 'Notieren Sie die Wiederherstellungsphrase für {wallet}',
      phrase: 'Wiederherstellungsphrase',
      keep: 'Schreiben Sie diese Wörter in dieser Reihenfolge auf und bewahren Sie sie offline auf. Wer sie kennt, kontrolliert die Wallet.',
      added: 'Hronaut fügt die Wallet hinzu, sobald Sie bestätigen, dass Sie die Wörter gesichert haben.'
    },
    claudeSetup: {
      file: 'Datei',
      added: 'Neuer Eintrag in "mcpServers"',
      replaces: 'Eintrag, den er ersetzt'
    },
    sitePermission: {
      embeddedIn: 'Eingebettet in {site}',
      wants: {
        camera: '{origin} möchte Ihre Kamera verwenden',
        microphone: '{origin} möchte Ihr Mikrofon verwenden',
        cameraAndMicrophone: '{origin} möchte Ihre Kamera und Ihr Mikrofon verwenden',
        geolocation: '{origin} möchte Ihren Standort erfahren',
        notifications: '{origin} möchte Benachrichtigungen anzeigen',
        clipboardRead: '{origin} möchte Text und Bilder sehen, die Sie kopieren',
        clipboardWrite: '{origin} möchte Text und Bilder in Ihre Zwischenablage kopieren',
        midiSysex: '{origin} möchte Ihre MIDI-Geräte steuern und neu programmieren',
        fileSystem: '{origin} möchte eine Datei oder einen Ordner auf Ihrem Computer verwenden',
        openExternal: '{origin} möchte eine App auf Ihrem Computer öffnen',
        fullscreen: '{origin} möchte den Vollbildmodus verwenden',
        idleDetection: '{origin} möchte wissen, wann Sie dieses Gerät verwenden',
        keyboardLock: '{origin} möchte Ihre Tastenkombinationen abfangen',
        pointerLock: '{origin} möchte Ihren Mauszeiger sperren und ausblenden',
        persistentStorage: '{origin} möchte Daten dauerhaft auf diesem Gerät speichern',
        screenWakeLock: '{origin} möchte Ihren Bildschirm eingeschaltet lassen',
        storageAccess: '{origin} möchte seine Cookies und Websitedaten auf dieser Seite verwenden',
        topLevelStorageAccess: '{origin} möchte Cookies und Websitedaten verwandter Websites verwenden',
        windowManagement: '{origin} möchte Fenster auf all Ihren Bildschirmen verwalten',
        displayCapture: '{origin} möchte Ihren Bildschirm sehen',
        other: '{origin} möchte „{permission}“ verwenden'
      }
    }
  },
  'fr-FR': {
    close: 'Fermer',
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
        clipboardWrite: '{origin} souhaite copier du texte et des images dans votre presse-papiers',
        midiSysex: '{origin} souhaite contrôler et reprogrammer vos appareils MIDI',
        fileSystem: '{origin} souhaite utiliser un fichier ou un dossier de votre ordinateur',
        openExternal: '{origin} souhaite ouvrir une application de votre ordinateur',
        fullscreen: '{origin} souhaite passer en plein écran',
        idleDetection: '{origin} souhaite savoir quand vous utilisez cet appareil',
        keyboardLock: '{origin} souhaite intercepter vos raccourcis clavier',
        pointerLock: '{origin} souhaite verrouiller et masquer le pointeur de votre souris',
        persistentStorage: '{origin} souhaite stocker durablement des données sur cet appareil',
        screenWakeLock: '{origin} souhaite garder votre écran allumé',
        storageAccess: '{origin} souhaite utiliser ses cookies et données de site sur cette page',
        topLevelStorageAccess: '{origin} souhaite utiliser les cookies et données de sites associés',
        windowManagement: '{origin} souhaite gérer les fenêtres sur tous vos écrans',
        displayCapture: '{origin} souhaite voir votre écran',
        other: '{origin} souhaite utiliser « {permission} »'
      }
    }
  },
  'es-ES': {
    close: 'Cerrar',
    savePassword: {
      eyebrow: 'Contraseñas guardadas',
      save: '¿Guardar tu contraseña para {origin}?',
      update: '¿Actualizar la contraseña guardada para {origin}?',
      username: 'Nombre de usuario',
      noUsername: 'La página no envió ningún nombre de usuario.',
      stored: 'Hronaut la cifra con el almacenamiento seguro del sistema operativo. Las contraseñas guardadas nunca se exponen mediante MCP.'
    },
    walletRecovery: {
      eyebrow: 'Nuevo monedero',
      headline: 'Anota la frase de recuperación de {wallet}',
      phrase: 'Frase de recuperación',
      keep: 'Anota estas palabras en orden y guárdalas sin conexión. Quien las tenga controla el monedero.',
      added: 'Hronaut añadirá el monedero en cuanto confirmes que las has guardado.'
    },
    claudeSetup: {
      file: 'Archivo',
      added: 'Nueva entrada en "mcpServers"',
      replaces: 'Entrada que sustituye'
    },
    sitePermission: {
      embeddedIn: 'Insertado en {site}',
      wants: {
        camera: '{origin} quiere usar tu cámara',
        microphone: '{origin} quiere usar tu micrófono',
        cameraAndMicrophone: '{origin} quiere usar tu cámara y tu micrófono',
        geolocation: '{origin} quiere conocer tu ubicación',
        notifications: '{origin} quiere mostrar notificaciones',
        clipboardRead: '{origin} quiere ver el texto y las imágenes que copias',
        clipboardWrite: '{origin} quiere copiar texto e imágenes en tu portapapeles',
        midiSysex: '{origin} quiere controlar y reprogramar tus dispositivos MIDI',
        fileSystem: '{origin} quiere usar un archivo o una carpeta de tu ordenador',
        openExternal: '{origin} quiere abrir una aplicación de tu ordenador',
        fullscreen: '{origin} quiere usar la pantalla completa',
        idleDetection: '{origin} quiere saber cuándo usas este dispositivo',
        keyboardLock: '{origin} quiere capturar tus atajos de teclado',
        pointerLock: '{origin} quiere bloquear y ocultar el puntero del ratón',
        persistentStorage: '{origin} quiere guardar datos de forma permanente en este dispositivo',
        screenWakeLock: '{origin} quiere mantener la pantalla encendida',
        storageAccess: '{origin} quiere usar sus cookies y datos del sitio en esta página',
        topLevelStorageAccess: '{origin} quiere usar cookies y datos de sitios relacionados',
        windowManagement: '{origin} quiere gestionar ventanas en todas tus pantallas',
        displayCapture: '{origin} quiere ver tu pantalla',
        other: '{origin} quiere usar «{permission}»'
      }
    }
  },
  'pl-PL': {
    close: 'Zamknij',
    savePassword: {
      eyebrow: 'Zapisane hasła',
      save: 'Zapisać hasło dla {origin}?',
      update: 'Zaktualizować zapisane hasło dla {origin}?',
      username: 'Nazwa użytkownika',
      noUsername: 'Strona nie wysłała nazwy użytkownika.',
      stored: 'Hronaut szyfruje je za pomocą bezpiecznej pamięci systemu operacyjnego. Zapisane hasła nigdy nie są udostępniane przez MCP.'
    },
    walletRecovery: {
      eyebrow: 'Nowy portfel',
      headline: 'Zapisz frazę odzyskiwania portfela {wallet}',
      phrase: 'Fraza odzyskiwania',
      keep: 'Zapisz te słowa w tej kolejności i przechowuj je offline. Kto je zna, ten kontroluje portfel.',
      added: 'Hronaut doda portfel, gdy potwierdzisz ich zapisanie.'
    },
    claudeSetup: {
      file: 'Plik',
      added: 'Nowy wpis w "mcpServers"',
      replaces: 'Wpis, który zastąpi'
    },
    sitePermission: {
      embeddedIn: 'Osadzono w {site}',
      wants: {
        camera: '{origin} chce używać Twojej kamery',
        microphone: '{origin} chce używać Twojego mikrofonu',
        cameraAndMicrophone: '{origin} chce używać Twojej kamery i mikrofonu',
        geolocation: '{origin} chce znać Twoją lokalizację',
        notifications: '{origin} chce wyświetlać powiadomienia',
        clipboardRead: '{origin} chce widzieć tekst i obrazy, które kopiujesz',
        clipboardWrite: '{origin} chce kopiować tekst i obrazy do Twojego schowka',
        midiSysex: '{origin} chce sterować Twoimi urządzeniami MIDI i je przeprogramowywać',
        fileSystem: '{origin} chce używać pliku lub folderu na Twoim komputerze',
        openExternal: '{origin} chce otworzyć aplikację na Twoim komputerze',
        fullscreen: '{origin} chce używać pełnego ekranu',
        idleDetection: '{origin} chce wiedzieć, kiedy używasz tego urządzenia',
        keyboardLock: '{origin} chce przechwytywać Twoje skróty klawiszowe',
        pointerLock: '{origin} chce zablokować i ukryć wskaźnik myszy',
        persistentStorage: '{origin} chce trwale przechowywać dane na tym urządzeniu',
        screenWakeLock: '{origin} chce, aby ekran pozostał włączony',
        storageAccess: '{origin} chce używać swoich plików cookie i danych witryny na tej stronie',
        topLevelStorageAccess: '{origin} chce używać plików cookie i danych powiązanych witryn',
        windowManagement: '{origin} chce zarządzać oknami na wszystkich Twoich ekranach',
        displayCapture: '{origin} chce widzieć Twój ekran',
        other: '{origin} chce używać uprawnienia „{permission}”'
      }
    }
  },
  'it-IT': {
    close: 'Chiudi',
    savePassword: {
      eyebrow: 'Password salvate',
      save: 'Vuoi salvare la password per {origin}?',
      update: 'Vuoi aggiornare la password salvata per {origin}?',
      username: 'Nome utente',
      noUsername: 'La pagina non ha inviato alcun nome utente.',
      stored: 'Hronaut la crittografa con l’archivio sicuro del sistema operativo. Le password salvate non vengono mai esposte tramite MCP.'
    },
    walletRecovery: {
      eyebrow: 'Nuovo wallet',
      headline: 'Annota la frase di recupero per {wallet}',
      phrase: 'Frase di recupero',
      keep: 'Annota queste parole nell’ordine indicato e conservale offline. Chiunque le possieda controlla il wallet.',
      added: 'Hronaut aggiunge il wallet dopo che hai confermato di averle salvate.'
    },
    claudeSetup: {
      file: 'File',
      added: 'Nuova voce in "mcpServers"',
      replaces: 'Voce che sostituisce'
    },
    sitePermission: {
      embeddedIn: 'Incorporato in {site}',
      wants: {
        camera: '{origin} vuole usare la fotocamera',
        microphone: '{origin} vuole usare il microfono',
        cameraAndMicrophone: '{origin} vuole usare la fotocamera e il microfono',
        geolocation: '{origin} vuole conoscere la tua posizione',
        notifications: '{origin} vuole mostrare notifiche',
        clipboardRead: '{origin} vuole vedere il testo e le immagini che copi',
        clipboardWrite: '{origin} vuole copiare testo e immagini negli appunti',
        midiSysex: '{origin} vuole controllare e riprogrammare i tuoi dispositivi MIDI',
        fileSystem: '{origin} vuole usare un file o una cartella sul tuo computer',
        openExternal: '{origin} vuole aprire un’app sul tuo computer',
        fullscreen: '{origin} vuole usare lo schermo intero',
        idleDetection: '{origin} vuole sapere quando stai usando questo dispositivo',
        keyboardLock: '{origin} vuole acquisire le tue scorciatoie da tastiera',
        pointerLock: '{origin} vuole bloccare e nascondere il puntatore del mouse',
        persistentStorage: '{origin} vuole archiviare dati in modo permanente su questo dispositivo',
        screenWakeLock: '{origin} vuole mantenere lo schermo acceso',
        storageAccess: '{origin} vuole usare i propri cookie e dati dei siti in questa pagina',
        topLevelStorageAccess: '{origin} vuole usare cookie e dati dei siti di siti web correlati',
        windowManagement: '{origin} vuole gestire le finestre su tutti i tuoi schermi',
        displayCapture: '{origin} vuole vedere il tuo schermo',
        other: '{origin} vuole usare “{permission}”'
      }
    }
  },
  'pt-BR': {
    close: 'Fechar',
    savePassword: {
      eyebrow: 'Senhas salvas',
      save: 'Salvar sua senha de {origin}?',
      update: 'Atualizar sua senha salva de {origin}?',
      username: 'Nome de usuário',
      noUsername: 'A página não enviou um nome de usuário junto.',
      stored: 'O Hronaut a criptografa com o armazenamento seguro do sistema operacional. As senhas salvas nunca são expostas pelo MCP.'
    },
    walletRecovery: {
      eyebrow: 'Nova carteira',
      headline: 'Anote a frase de recuperação de {wallet}',
      phrase: 'Frase de recuperação',
      keep: 'Anote estas palavras na ordem e guarde-as off-line. Qualquer pessoa que as tiver controla a carteira.',
      added: 'O Hronaut adiciona a carteira assim que você confirmar que as salvou.'
    },
    claudeSetup: {
      file: 'Arquivo',
      added: 'Nova entrada em "mcpServers"',
      replaces: 'Entrada que ela substitui'
    },
    sitePermission: {
      embeddedIn: 'Incorporado em {site}',
      wants: {
        camera: '{origin} quer usar sua câmera',
        microphone: '{origin} quer usar seu microfone',
        cameraAndMicrophone: '{origin} quer usar sua câmera e seu microfone',
        geolocation: '{origin} quer saber sua localização',
        notifications: '{origin} quer mostrar notificações',
        clipboardRead: '{origin} quer ver textos e imagens que você copia',
        clipboardWrite: '{origin} quer copiar textos e imagens para sua área de transferência',
        midiSysex: '{origin} quer controlar e reprogramar seus dispositivos MIDI',
        fileSystem: '{origin} quer usar um arquivo ou uma pasta do seu computador',
        openExternal: '{origin} quer abrir um app no seu computador',
        fullscreen: '{origin} quer usar a tela cheia',
        idleDetection: '{origin} quer saber quando você está usando este dispositivo',
        keyboardLock: '{origin} quer capturar seus atalhos de teclado',
        pointerLock: '{origin} quer bloquear e ocultar o ponteiro do mouse',
        persistentStorage: '{origin} quer armazenar dados permanentemente neste dispositivo',
        screenWakeLock: '{origin} quer manter sua tela ligada',
        storageAccess: '{origin} quer usar os cookies e dados do site dele nesta página',
        topLevelStorageAccess: '{origin} quer usar cookies e dados de sites relacionados',
        windowManagement: '{origin} quer gerenciar janelas em todas as suas telas',
        displayCapture: '{origin} quer ver sua tela',
        other: '{origin} quer usar “{permission}”'
      }
    }
  },
  'tr-TR': {
    close: 'Kapat',
    savePassword: {
      eyebrow: 'Kayıtlı şifreler',
      save: '{origin} için şifreniz kaydedilsin mi?',
      update: '{origin} için kayıtlı şifreniz güncellensin mi?',
      username: 'Kullanıcı adı',
      noUsername: 'Sayfa, şifreyle birlikte bir kullanıcı adı göndermedi.',
      stored: 'Hronaut şifreyi işletim sisteminizin güvenli depolama alanıyla şifreler. Kayıtlı şifreler MCP üzerinden hiçbir zaman paylaşılmaz.'
    },
    walletRecovery: {
      eyebrow: 'Yeni cüzdan',
      headline: '{wallet} için kurtarma ifadesini not edin',
      phrase: 'Kurtarma ifadesi',
      keep: 'Bu kelimeleri sırasıyla not edin ve çevrimdışı saklayın. Bu kelimelere sahip olan herkes cüzdanı kontrol eder.',
      added: 'Hronaut, kelimeleri kaydettiğinizi onayladığınızda cüzdanı ekler.'
    },
    claudeSetup: {
      file: 'Dosya',
      added: '"mcpServers" içindeki yeni giriş',
      replaces: 'Yerini aldığı giriş'
    },
    sitePermission: {
      embeddedIn: '{site} içine yerleştirilmiş',
      wants: {
        camera: '{origin} kameranızı kullanmak istiyor',
        microphone: '{origin} mikrofonunuzu kullanmak istiyor',
        cameraAndMicrophone: '{origin} kameranızı ve mikrofonunuzu kullanmak istiyor',
        geolocation: '{origin} konumunuzu öğrenmek istiyor',
        notifications: '{origin} bildirim göstermek istiyor',
        clipboardRead: '{origin} kopyaladığınız metin ve resimleri görmek istiyor',
        clipboardWrite: '{origin} panonuza metin ve resim kopyalamak istiyor',
        midiSysex: '{origin} MIDI cihazlarınızı kontrol etmek ve yeniden programlamak istiyor',
        fileSystem: '{origin} bilgisayarınızdaki bir dosyayı veya klasörü kullanmak istiyor',
        openExternal: '{origin} bilgisayarınızda bir uygulama açmak istiyor',
        fullscreen: '{origin} tam ekranı kullanmak istiyor',
        idleDetection: '{origin} bu cihazı ne zaman kullandığınızı bilmek istiyor',
        keyboardLock: '{origin} klavye kısayollarınızı yakalamak istiyor',
        pointerLock: '{origin} fare işaretçinizi kilitlemek ve gizlemek istiyor',
        persistentStorage: '{origin} bu cihazda kalıcı olarak veri depolamak istiyor',
        screenWakeLock: '{origin} ekranınızı açık tutmak istiyor',
        storageAccess: '{origin} bu sayfada kendi çerezlerini ve site verilerini kullanmak istiyor',
        topLevelStorageAccess: '{origin} ilişkili web sitelerinin çerezlerini ve site verilerini kullanmak istiyor',
        windowManagement: '{origin} tüm ekranlarınızdaki pencereleri yönetmek istiyor',
        displayCapture: '{origin} ekranınızı görmek istiyor',
        other: '{origin} “{permission}” iznini kullanmak istiyor'
      }
    }
  },
  'hi-IN': {
    close: 'बंद करें',
    savePassword: {
      eyebrow: 'सेव किए गए पासवर्ड',
      save: '{origin} के लिए अपना पासवर्ड सेव करें?',
      update: '{origin} के लिए सेव किया गया अपना पासवर्ड अपडेट करें?',
      username: 'उपयोगकर्ता नाम',
      noUsername: 'पेज ने इसके साथ कोई उपयोगकर्ता नाम नहीं भेजा।',
      stored: 'Hronaut इसे आपके ऑपरेटिंग सिस्टम के सुरक्षित स्टोरेज से एन्क्रिप्ट करता है। सेव किए गए पासवर्ड कभी भी MCP के ज़रिए नहीं दिखाए जाते।'
    },
    walletRecovery: {
      eyebrow: 'नया वॉलेट',
      headline: '{wallet} का रिकवरी फ़्रेज़ लिख लें',
      phrase: 'रिकवरी फ़्रेज़',
      keep: 'इन शब्दों को क्रम से लिख लें और इन्हें ऑफ़लाइन रखें। जिसके पास भी ये शब्द होंगे, वॉलेट उसके कंट्रोल में होगा।',
      added: 'आपके यह पुष्टि करने पर कि आपने इन्हें सेव कर लिया है, Hronaut वॉलेट जोड़ देता है।'
    },
    claudeSetup: {
      file: 'फ़ाइल',
      added: '"mcpServers" में नई एंट्री',
      replaces: 'यह किस एंट्री की जगह लेती है'
    },
    sitePermission: {
      embeddedIn: '{site} में एम्बेड किया गया',
      wants: {
        camera: '{origin} आपके कैमरे का इस्तेमाल करना चाहता है',
        microphone: '{origin} आपके माइक्रोफ़ोन का इस्तेमाल करना चाहता है',
        cameraAndMicrophone: '{origin} आपके कैमरे और माइक्रोफ़ोन का इस्तेमाल करना चाहता है',
        geolocation: '{origin} आपकी जगह की जानकारी जानना चाहता है',
        notifications: '{origin} सूचनाएं दिखाना चाहता है',
        clipboardRead: '{origin} आपका कॉपी किया गया टेक्स्ट और इमेज देखना चाहता है',
        clipboardWrite: '{origin} आपके क्लिपबोर्ड पर टेक्स्ट और इमेज कॉपी करना चाहता है',
        midiSysex: '{origin} आपके MIDI डिवाइस को कंट्रोल और फिर से प्रोग्राम करना चाहता है',
        fileSystem: '{origin} आपके कंप्यूटर की किसी फ़ाइल या फ़ोल्डर का इस्तेमाल करना चाहता है',
        openExternal: '{origin} आपके कंप्यूटर पर कोई ऐप खोलना चाहता है',
        fullscreen: '{origin} फ़ुल स्क्रीन का इस्तेमाल करना चाहता है',
        idleDetection: '{origin} जानना चाहता है कि आप इस डिवाइस का इस्तेमाल कब कर रहे हैं',
        keyboardLock: '{origin} आपके कीबोर्ड शॉर्टकट कैप्चर करना चाहता है',
        pointerLock: '{origin} आपके माउस पॉइंटर को लॉक करना और छिपाना चाहता है',
        persistentStorage: '{origin} इस डिवाइस पर हमेशा के लिए डेटा सेव करना चाहता है',
        screenWakeLock: '{origin} आपकी स्क्रीन चालू रखना चाहता है',
        storageAccess: '{origin} इस पेज पर अपनी कुकी और साइट डेटा का इस्तेमाल करना चाहता है',
        topLevelStorageAccess: '{origin} मिलती-जुलती वेबसाइटों की कुकी और साइट डेटा का इस्तेमाल करना चाहता है',
        windowManagement: '{origin} आपके सभी डिस्प्ले पर विंडो मैनेज करना चाहता है',
        displayCapture: '{origin} आपकी स्क्रीन देखना चाहता है',
        other: '{origin} “{permission}” का इस्तेमाल करना चाहता है'
      }
    }
  },
  'ja-JP': {
    close: '閉じる',
    savePassword: {
      eyebrow: '保存したパスワード',
      save: '{origin} のパスワードを保存しますか？',
      update: '{origin} の保存済みパスワードを更新しますか？',
      username: 'ユーザー名',
      noUsername: 'このページからユーザー名は送信されませんでした。',
      stored: 'Hronaut はオペレーティング システムの安全なストレージを使ってパスワードを暗号化します。保存したパスワードが MCP を通じて公開されることはありません。'
    },
    walletRecovery: {
      eyebrow: '新しいウォレット',
      headline: '{wallet} の復元フレーズを書き留めてください',
      phrase: '復元フレーズ',
      keep: 'これらの単語を順番どおりに書き留めて、オフラインで保管してください。これを知っている人は誰でもウォレットを操作できます。',
      added: '保存したことを確認すると、Hronaut がウォレットを追加します。'
    },
    claudeSetup: {
      file: 'ファイル',
      added: '"mcpServers" の新しいエントリ',
      replaces: '置き換えられるエントリ'
    },
    sitePermission: {
      embeddedIn: '{site} に埋め込まれています',
      wants: {
        camera: '{origin} がカメラの使用を求めています',
        microphone: '{origin} がマイクの使用を求めています',
        cameraAndMicrophone: '{origin} がカメラとマイクの使用を求めています',
        geolocation: '{origin} が現在地の情報へのアクセスを求めています',
        notifications: '{origin} が通知の表示を求めています',
        clipboardRead: '{origin} が、コピーしたテキストや画像の確認を求めています',
        clipboardWrite: '{origin} が、テキストや画像をクリップボードにコピーすることを求めています',
        midiSysex: '{origin} が MIDI デバイスの制御と再プログラムを求めています',
        fileSystem: '{origin} が、パソコン上のファイルまたはフォルダの使用を求めています',
        openExternal: '{origin} が、パソコン上のアプリを開こうとしています',
        fullscreen: '{origin} が全画面表示の使用を求めています',
        idleDetection: '{origin} が、このデバイスを使用中かどうかの把握を求めています',
        keyboardLock: '{origin} が、キーボード ショートカットの取得を求めています',
        pointerLock: '{origin} が、マウス ポインタのロックと非表示を求めています',
        persistentStorage: '{origin} が、このデバイスへのデータの永続的な保存を求めています',
        screenWakeLock: '{origin} が、画面をオンのままにすることを求めています',
        storageAccess: '{origin} が、このページで自身の Cookie とサイトデータの使用を求めています',
        topLevelStorageAccess: '{origin} が、関連するウェブサイトの Cookie とサイトデータの使用を求めています',
        windowManagement: '{origin} が、すべてのディスプレイ上のウィンドウの管理を求めています',
        displayCapture: '{origin} が画面の共有を求めています',
        other: '{origin} が「{permission}」の使用を求めています'
      }
    }
  },
  'ko-KR': {
    close: '닫기',
    savePassword: {
      eyebrow: '저장된 비밀번호',
      save: '{origin}의 비밀번호를 저장하시겠습니까?',
      update: '{origin}의 저장된 비밀번호를 업데이트하시겠습니까?',
      username: '사용자 이름',
      noUsername: '페이지에서 사용자 이름을 함께 보내지 않았습니다.',
      stored: 'Hronaut은 운영체제의 보안 저장소로 비밀번호를 암호화합니다. 저장된 비밀번호는 MCP를 통해 노출되지 않습니다.'
    },
    walletRecovery: {
      eyebrow: '새 지갑',
      headline: '{wallet}의 복구 문구를 적어 두세요',
      phrase: '복구 문구',
      keep: '이 단어들을 순서대로 적어 오프라인에 보관하세요. 이 단어를 가진 사람은 누구나 지갑을 제어할 수 있습니다.',
      added: '단어를 저장했음을 확인하면 Hronaut에서 지갑을 추가합니다.'
    },
    claudeSetup: {
      file: '파일',
      added: '"mcpServers"의 새 항목',
      replaces: '대체되는 항목'
    },
    sitePermission: {
      embeddedIn: '{site}에 삽입됨',
      wants: {
        camera: '{origin}에서 카메라를 사용하려고 합니다',
        microphone: '{origin}에서 마이크를 사용하려고 합니다',
        cameraAndMicrophone: '{origin}에서 카메라와 마이크를 사용하려고 합니다',
        geolocation: '{origin}에서 사용자의 위치를 확인하려고 합니다',
        notifications: '{origin}에서 알림을 표시하려고 합니다',
        clipboardRead: '{origin}에서 복사한 텍스트와 이미지를 보려고 합니다',
        clipboardWrite: '{origin}에서 텍스트와 이미지를 클립보드에 복사하려고 합니다',
        midiSysex: '{origin}에서 MIDI 기기를 제어하고 다시 프로그래밍하려고 합니다',
        fileSystem: '{origin}에서 컴퓨터의 파일이나 폴더를 사용하려고 합니다',
        openExternal: '{origin}에서 컴퓨터의 앱을 열려고 합니다',
        fullscreen: '{origin}에서 전체 화면을 사용하려고 합니다',
        idleDetection: '{origin}에서 사용자가 이 기기를 사용 중인지 확인하려고 합니다',
        keyboardLock: '{origin}에서 키보드 단축키를 캡처하려고 합니다',
        pointerLock: '{origin}에서 마우스 포인터를 잠그고 숨기려고 합니다',
        persistentStorage: '{origin}에서 이 기기에 데이터를 영구적으로 저장하려고 합니다',
        screenWakeLock: '{origin}에서 화면을 켜진 상태로 유지하려고 합니다',
        storageAccess: '{origin}에서 이 페이지에서 자체 쿠키와 사이트 데이터를 사용하려고 합니다',
        topLevelStorageAccess: '{origin}에서 관련 웹사이트의 쿠키와 사이트 데이터를 사용하려고 합니다',
        windowManagement: '{origin}에서 모든 디스플레이의 창을 관리하려고 합니다',
        displayCapture: '{origin}에서 화면을 보려고 합니다',
        other: '{origin}에서 ‘{permission}’ 권한을 사용하려고 합니다'
      }
    }
  },
  'zh-CN': {
    close: '关闭',
    savePassword: {
      eyebrow: '已保存的密码',
      save: '要保存您在 {origin} 上的密码吗？',
      update: '要更新您在 {origin} 上已保存的密码吗？',
      username: '用户名',
      noUsername: '页面未随密码一起发送用户名。',
      stored: 'Hronaut 会使用操作系统的安全存储对其进行加密。已保存的密码绝不会通过 MCP 公开。'
    },
    walletRecovery: {
      eyebrow: '新钱包',
      headline: '请写下 {wallet} 的恢复短语',
      phrase: '恢复短语',
      keep: '请按顺序写下这些单词，并离线保存。任何拥有这些单词的人都能控制此钱包。',
      added: '在您确认已保存后，Hronaut 才会添加此钱包。'
    },
    claudeSetup: {
      file: '文件',
      added: '"mcpServers" 中的新条目',
      replaces: '它将替换的条目'
    },
    sitePermission: {
      embeddedIn: '嵌入在 {site} 中',
      wants: {
        camera: '{origin} 想要使用您的摄像头',
        microphone: '{origin} 想要使用您的麦克风',
        cameraAndMicrophone: '{origin} 想要使用您的摄像头和麦克风',
        geolocation: '{origin} 想要知道您的位置',
        notifications: '{origin} 想要显示通知',
        clipboardRead: '{origin} 想要查看您复制的文字和图片',
        clipboardWrite: '{origin} 想要将文字和图片复制到您的剪贴板',
        midiSysex: '{origin} 想要控制您的 MIDI 设备并对其重新编程',
        fileSystem: '{origin} 想要使用您计算机上的文件或文件夹',
        openExternal: '{origin} 想要打开您计算机上的应用',
        fullscreen: '{origin} 想要使用全屏',
        idleDetection: '{origin} 想要知道您何时在使用此设备',
        keyboardLock: '{origin} 想要捕获您的键盘快捷键',
        pointerLock: '{origin} 想要锁定并隐藏您的鼠标指针',
        persistentStorage: '{origin} 想要在此设备上永久存储数据',
        screenWakeLock: '{origin} 想要让您的屏幕保持常亮',
        storageAccess: '{origin} 想要在此页面上使用其 Cookie 和网站数据',
        topLevelStorageAccess: '{origin} 想要使用相关网站的 Cookie 和网站数据',
        windowManagement: '{origin} 想要管理您所有显示器上的窗口',
        displayCapture: '{origin} 想要查看您的屏幕',
        other: '{origin} 想要使用“{permission}”'
      }
    }
  },
  'zh-TW': {
    close: '關閉',
    savePassword: {
      eyebrow: '已儲存的密碼',
      save: '要儲存 {origin} 的密碼嗎？',
      update: '要更新 {origin} 的已儲存密碼嗎？',
      username: '使用者名稱',
      noUsername: '網頁未一併傳送使用者名稱。',
      stored: 'Hronaut 會使用作業系統的安全儲存空間加密密碼。已儲存的密碼絕不會透過 MCP 外洩。'
    },
    walletRecovery: {
      eyebrow: '新錢包',
      headline: '請抄下 {wallet} 的復原詞組',
      phrase: '復原詞組',
      keep: '請依序抄下這些字詞，並離線保存。任何取得這些字詞的人都能控制這個錢包。',
      added: '在你確認已保存後，Hronaut 就會新增這個錢包。'
    },
    claudeSetup: {
      file: '檔案',
      added: '"mcpServers" 中的新項目',
      replaces: '將被取代的項目'
    },
    sitePermission: {
      embeddedIn: '嵌入於 {site}',
      wants: {
        camera: '{origin} 想要使用你的攝影機',
        microphone: '{origin} 想要使用你的麥克風',
        cameraAndMicrophone: '{origin} 想要使用你的攝影機和麥克風',
        geolocation: '{origin} 想要知道你的位置',
        notifications: '{origin} 想要顯示通知',
        clipboardRead: '{origin} 想要查看你複製的文字和圖片',
        clipboardWrite: '{origin} 想要將文字和圖片複製到你的剪貼簿',
        midiSysex: '{origin} 想要控制你的 MIDI 裝置並重新設定程式',
        fileSystem: '{origin} 想要使用你電腦上的檔案或資料夾',
        openExternal: '{origin} 想要開啟你電腦上的應用程式',
        fullscreen: '{origin} 想要使用全螢幕',
        idleDetection: '{origin} 想要知道你何時在使用這部裝置',
        keyboardLock: '{origin} 想要擷取你的鍵盤快速鍵',
        pointerLock: '{origin} 想要鎖定並隱藏你的滑鼠游標',
        persistentStorage: '{origin} 想要在這部裝置上永久儲存資料',
        screenWakeLock: '{origin} 想要讓你的螢幕保持開啟',
        storageAccess: '{origin} 想要在這個頁面上使用自己的 Cookie 和網站資料',
        topLevelStorageAccess: '{origin} 想要使用相關網站的 Cookie 和網站資料',
        windowManagement: '{origin} 想要管理你所有螢幕上的視窗',
        displayCapture: '{origin} 想要查看你的螢幕',
        other: '{origin} 想要使用「{permission}」'
      }
    }
  },
}

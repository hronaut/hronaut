/**
 * The words of Hronaut's own dialogs that main asks through the shell (see `src/shared/trusted-dialogs.ts`). A
 * dialog's buttons, and the lines it shares with the system dialog Hronaut falls back to, stay in `native.dialog`; a
 * website's sign-in, which no system dialog asks, keeps its own.
 */
export const trustedDialogMessages = {
  'en-US': {
    close: 'Close',
    httpAuth: {
      eyebrow: 'Sign in',
      headline: 'Sign in to {origin}',
      notPrivate: 'Your connection to this site is not private. Anyone on the network can read your username and password.',
      workspace: 'You stay signed in to this website in the “{workspace}” workspace until Hronaut quits.',
      sent: 'Hronaut sends your username and password only to this website and never shows them to agents.',
      username: 'Username',
      password: 'Password',
      signIn: 'Sign in'
    },
    certificate: {
      eyebrow: 'Not private',
      headline: 'Proceed to {host}?',
      authority: 'Its security certificate is not from an authority this computer trusts.',
      name: 'Its security certificate is for another website.',
      date: 'Its security certificate has expired or is not valid yet.',
      other: 'Its security certificate cannot be verified.',
      risk: 'Someone on the network might be pretending to be this website to read what you send it, such as passwords.',
      workspace: 'Hronaut trusts this certificate for this website in the “{workspace}” workspace until it quits, and agents in the workspace can open it too.',
      session: 'Hronaut trusts this certificate for this website until it quits.',
      back: 'Back to safety',
      proceed: 'Proceed (unsafe)'
    },
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
    httpAuth: {
      eyebrow: 'Вхід',
      headline: 'Увійдіть на {origin}',
      notPrivate: 'З’єднання з цим сайтом не захищене. Будь-хто в мережі може прочитати ваше ім’я користувача й пароль.',
      workspace: 'Ви залишатиметеся в системі на цьому сайті в робочому просторі «{workspace}», доки Hronaut не закриється.',
      sent: 'Hronaut надсилає ваше ім’я користувача й пароль лише цьому сайту та ніколи не показує їх агентам.',
      username: 'Ім’я користувача',
      password: 'Пароль',
      signIn: 'Увійти'
    },
    certificate: {
      eyebrow: 'Не захищено',
      headline: 'Перейти на {host}?',
      authority: 'Його сертифікат безпеки видав центр, якому цей комп’ютер не довіряє.',
      name: 'Його сертифікат безпеки належить іншому сайту.',
      date: 'Термін дії його сертифіката безпеки минув або ще не настав.',
      other: 'Його сертифікат безпеки не вдається перевірити.',
      risk: 'Хтось у мережі може видавати себе за цей сайт, щоб читати те, що ви йому надсилаєте, як-от паролі.',
      workspace: 'Hronaut довірятиме цьому сертифікату для цього сайту в робочому просторі «{workspace}», доки Hronaut не закриється, і агенти цього робочого простору теж зможуть його відкривати.',
      session: 'Hronaut довірятиме цьому сертифікату для цього сайту, доки Hronaut не закриється.',
      back: 'Повернутися в безпечне місце',
      proceed: 'Перейти (небезпечно)'
    },
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
    httpAuth: {
      eyebrow: 'Вход',
      headline: 'Войдите на {origin}',
      notPrivate: 'Подключение к этому сайту не защищено. Любой в сети может прочитать ваше имя пользователя и пароль.',
      workspace: 'Вы останетесь в системе на этом сайте в рабочем пространстве «{workspace}», пока Hronaut не закроется.',
      sent: 'Hronaut отправляет ваше имя пользователя и пароль только этому сайту и никогда не показывает их агентам.',
      username: 'Имя пользователя',
      password: 'Пароль',
      signIn: 'Войти'
    },
    certificate: {
      eyebrow: 'Не защищено',
      headline: 'Перейти на {host}?',
      authority: 'Его сертификат безопасности выдан центром, которому этот компьютер не доверяет.',
      name: 'Его сертификат безопасности выдан другому сайту.',
      date: 'Срок действия его сертификата безопасности истёк или ещё не начался.',
      other: 'Его сертификат безопасности не удаётся проверить.',
      risk: 'Кто-то в сети может выдавать себя за этот сайт, чтобы читать то, что вы ему отправляете, например пароли.',
      workspace: 'Hronaut будет доверять этому сертификату для этого сайта в рабочем пространстве «{workspace}», пока Hronaut не закроется, и агенты этого рабочего пространства тоже смогут его открывать.',
      session: 'Hronaut будет доверять этому сертификату для этого сайта, пока Hronaut не закроется.',
      back: 'Вернуться в безопасное место',
      proceed: 'Перейти (небезопасно)'
    },
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
    httpAuth: {
      eyebrow: 'Anmelden',
      headline: 'Bei {origin} anmelden',
      notPrivate: 'Ihre Verbindung zu dieser Website ist nicht privat. Jeder im Netzwerk kann Ihren Benutzernamen und Ihr Passwort lesen.',
      workspace: 'Sie bleiben auf dieser Website im Arbeitsbereich „{workspace}“ angemeldet, bis Hronaut beendet wird.',
      sent: 'Hronaut sendet Ihren Benutzernamen und Ihr Passwort nur an diese Website und zeigt sie Agenten nie.',
      username: 'Benutzername',
      password: 'Passwort',
      signIn: 'Anmelden'
    },
    certificate: {
      eyebrow: 'Nicht sicher',
      headline: 'Weiter zu {host}?',
      authority: 'Das Sicherheitszertifikat stammt nicht von einer Stelle, der dieser Computer vertraut.',
      name: 'Das Sicherheitszertifikat gilt für eine andere Website.',
      date: 'Das Sicherheitszertifikat ist abgelaufen oder noch nicht gültig.',
      other: 'Das Sicherheitszertifikat lässt sich nicht überprüfen.',
      risk: 'Jemand im Netzwerk könnte sich als diese Website ausgeben, um mitzulesen, was Sie ihr senden, etwa Passwörter.',
      workspace: 'Hronaut vertraut diesem Zertifikat für diese Website im Arbeitsbereich „{workspace}“, bis Hronaut beendet wird, und auch die Agenten im Arbeitsbereich können sie öffnen.',
      session: 'Hronaut vertraut diesem Zertifikat für diese Website, bis Hronaut beendet wird.',
      back: 'Zurück zu sicherer Seite',
      proceed: 'Weiter (unsicher)'
    },
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
    httpAuth: {
      eyebrow: 'Iniciar sesión',
      headline: 'Iniciar sesión en {origin}',
      notPrivate: 'Tu conexión con este sitio no es privada. Cualquiera en la red puede leer tu nombre de usuario y tu contraseña.',
      workspace: 'Sigues con la sesión iniciada en este sitio web en el espacio de trabajo «{workspace}» hasta que se cierre Hronaut.',
      sent: 'Hronaut envía tu nombre de usuario y tu contraseña solo a este sitio web y nunca se los muestra a los agentes.',
      username: 'Nombre de usuario',
      password: 'Contraseña',
      signIn: 'Iniciar sesión'
    },
    certificate: {
      eyebrow: 'Conexión no privada',
      headline: '¿Acceder a {host}?',
      authority: 'Su certificado de seguridad no procede de una autoridad en la que confíe este ordenador.',
      name: 'Su certificado de seguridad es de otro sitio web.',
      date: 'Su certificado de seguridad ha caducado o aún no es válido.',
      other: 'Su certificado de seguridad no se puede verificar.',
      risk: 'Alguien de la red podría estar haciéndose pasar por este sitio web para leer lo que le envías, como contraseñas.',
      workspace: 'Hronaut confía en este certificado para este sitio web en el espacio de trabajo «{workspace}» hasta que se cierre Hronaut, y los agentes del espacio de trabajo también pueden abrirlo.',
      session: 'Hronaut confía en este certificado para este sitio web hasta que se cierre Hronaut.',
      back: 'Volver a un lugar seguro',
      proceed: 'Acceder (no seguro)'
    },
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
    httpAuth: {
      eyebrow: 'Logowanie',
      headline: 'Zaloguj się do {origin}',
      notPrivate: 'Połączenie z tą witryną nie jest prywatne. Każdy w sieci może odczytać Twoją nazwę użytkownika i hasło.',
      workspace: 'Pozostajesz zalogowany w tej witrynie w obszarze roboczym „{workspace}”, dopóki Hronaut nie zostanie zamknięty.',
      sent: 'Hronaut wysyła Twoją nazwę użytkownika i hasło tylko do tej witryny i nigdy nie pokazuje ich agentom.',
      username: 'Nazwa użytkownika',
      password: 'Hasło',
      signIn: 'Zaloguj się'
    },
    certificate: {
      eyebrow: 'Połączenie nieprywatne',
      headline: 'Przejść do {host}?',
      authority: 'Jej certyfikat bezpieczeństwa nie pochodzi od urzędu, któremu ufa ten komputer.',
      name: 'Jej certyfikat bezpieczeństwa należy do innej witryny.',
      date: 'Jej certyfikat bezpieczeństwa wygasł lub nie jest jeszcze ważny.',
      other: 'Nie można zweryfikować jej certyfikatu bezpieczeństwa.',
      risk: 'Ktoś w sieci może podszywać się pod tę witrynę, aby czytać to, co do niej wysyłasz, na przykład hasła.',
      workspace: 'Hronaut ufa temu certyfikatowi dla tej witryny w obszarze roboczym „{workspace}”, dopóki Hronaut nie zostanie zamknięty, a agenci w tym obszarze roboczym też mogą ją otwierać.',
      session: 'Hronaut ufa temu certyfikatowi dla tej witryny, dopóki Hronaut nie zostanie zamknięty.',
      back: 'Wróć do bezpiecznej strony',
      proceed: 'Przejdź (niebezpieczne)'
    },
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
    httpAuth: {
      eyebrow: 'Accedi',
      headline: 'Accedi a {origin}',
      notPrivate: 'La connessione a questo sito non è privata. Chiunque sulla rete può leggere il tuo nome utente e la tua password.',
      workspace: 'Resti connesso a questo sito web nell’area di lavoro “{workspace}” finché Hronaut non viene chiuso.',
      sent: 'Hronaut invia il tuo nome utente e la tua password solo a questo sito web e non li mostra mai agli agenti.',
      username: 'Nome utente',
      password: 'Password',
      signIn: 'Accedi'
    },
    certificate: {
      eyebrow: 'Connessione non privata',
      headline: 'Procedere su {host}?',
      authority: 'Il suo certificato di sicurezza non proviene da un’autorità considerata attendibile da questo computer.',
      name: 'Il suo certificato di sicurezza è di un altro sito web.',
      date: 'Il suo certificato di sicurezza è scaduto o non è ancora valido.',
      other: 'Il suo certificato di sicurezza non può essere verificato.',
      risk: 'Qualcuno sulla rete potrebbe fingersi questo sito web per leggere ciò che gli invii, come le password.',
      workspace: 'Hronaut considera attendibile questo certificato per questo sito web nell’area di lavoro “{workspace}” finché Hronaut non viene chiuso, e anche gli agenti dell’area di lavoro possono aprirlo.',
      session: 'Hronaut considera attendibile questo certificato per questo sito web finché Hronaut non viene chiuso.',
      back: 'Torna al sicuro',
      proceed: 'Procedi (non sicuro)'
    },
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
    httpAuth: {
      eyebrow: 'Fazer login',
      headline: 'Fazer login em {origin}',
      notPrivate: 'Sua conexão com este site não é particular. Qualquer pessoa na rede pode ler seu nome de usuário e sua senha.',
      workspace: 'Você continua conectado a este site no espaço de trabalho “{workspace}” até o Hronaut ser fechado.',
      sent: 'O Hronaut envia seu nome de usuário e sua senha somente para este site e nunca os mostra aos agentes.',
      username: 'Nome de usuário',
      password: 'Senha',
      signIn: 'Fazer login'
    },
    certificate: {
      eyebrow: 'Conexão não particular',
      headline: 'Ir para {host}?',
      authority: 'O certificado de segurança dele não é de uma autoridade em que este computador confia.',
      name: 'O certificado de segurança dele é de outro site.',
      date: 'O certificado de segurança dele expirou ou ainda não é válido.',
      other: 'Não é possível verificar o certificado de segurança dele.',
      risk: 'Alguém na rede pode estar se passando por este site para ler o que você envia a ele, como senhas.',
      workspace: 'O Hronaut confia neste certificado para este site no espaço de trabalho “{workspace}” até o Hronaut ser fechado, e os agentes do espaço de trabalho também podem abri-lo.',
      session: 'O Hronaut confia neste certificado para este site até o Hronaut ser fechado.',
      back: 'Voltar à segurança',
      proceed: 'Ir (não seguro)'
    },
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
    httpAuth: {
      eyebrow: 'Oturum aç',
      headline: '{origin} sitesinde oturum açın',
      notPrivate: 'Bu siteye bağlantınız gizli değil. Ağdaki herkes kullanıcı adınızı ve şifrenizi okuyabilir.',
      workspace: 'Hronaut kapanana kadar “{workspace}” çalışma alanında bu web sitesinde oturumunuz açık kalır.',
      sent: 'Hronaut kullanıcı adınızı ve şifrenizi yalnızca bu web sitesine gönderir ve bunları ajanlara asla göstermez.',
      username: 'Kullanıcı adı',
      password: 'Şifre',
      signIn: 'Oturum aç'
    },
    certificate: {
      eyebrow: 'Gizli değil',
      headline: '{host} sitesine ilerlensin mi?',
      authority: 'Güvenlik sertifikası, bu bilgisayarın güvendiği bir yetkiliden alınmamış.',
      name: 'Güvenlik sertifikası başka bir web sitesine ait.',
      date: 'Güvenlik sertifikasının süresi dolmuş veya henüz geçerli değil.',
      other: 'Güvenlik sertifikası doğrulanamıyor.',
      risk: 'Ağdaki biri, bu web sitesine gönderdiklerinizi, örneğin şifreleri okumak için bu web sitesiymiş gibi davranıyor olabilir.',
      workspace: 'Hronaut kapanana kadar “{workspace}” çalışma alanında bu web sitesi için bu sertifikaya güvenir ve çalışma alanındaki ajanlar da siteyi açabilir.',
      session: 'Hronaut kapanana kadar bu web sitesi için bu sertifikaya güvenir.',
      back: 'Güvenli sayfaya dön',
      proceed: 'İlerle (güvenli değil)'
    },
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
    httpAuth: {
      eyebrow: 'साइन इन करें',
      headline: '{origin} में साइन इन करें',
      notPrivate: 'इस साइट से आपका कनेक्शन निजी नहीं है। नेटवर्क पर कोई भी आपका उपयोगकर्ता नाम और पासवर्ड पढ़ सकता है।',
      workspace: 'Hronaut बंद होने तक आप “{workspace}” वर्कस्पेस में इस वेबसाइट पर साइन इन रहते हैं।',
      sent: 'Hronaut आपका उपयोगकर्ता नाम और पासवर्ड सिर्फ़ इसी वेबसाइट को भेजता है और इन्हें एजेंटों को कभी नहीं दिखाता।',
      username: 'उपयोगकर्ता नाम',
      password: 'पासवर्ड',
      signIn: 'साइन इन करें'
    },
    certificate: {
      eyebrow: 'निजी नहीं',
      headline: '{host} पर जाएं?',
      authority: 'इसका सुरक्षा सर्टिफ़िकेट ऐसी अथॉरिटी का नहीं है जिस पर यह कंप्यूटर भरोसा करता है।',
      name: 'इसका सुरक्षा सर्टिफ़िकेट किसी दूसरी वेबसाइट का है।',
      date: 'इसके सुरक्षा सर्टिफ़िकेट की समय-सीमा खत्म हो गई है या यह अभी मान्य नहीं है।',
      other: 'इसके सुरक्षा सर्टिफ़िकेट की पुष्टि नहीं की जा सकती।',
      risk: 'हो सकता है कि नेटवर्क पर कोई इस वेबसाइट होने का दिखावा कर रहा हो, ताकि आप जो भेजते हैं, जैसे पासवर्ड, उसे पढ़ सके।',
      workspace: 'Hronaut बंद होने तक “{workspace}” वर्कस्पेस में इस वेबसाइट के लिए इस सर्टिफ़िकेट पर भरोसा करता है, और वर्कस्पेस के एजेंट भी इसे खोल सकते हैं।',
      session: 'Hronaut बंद होने तक इस वेबसाइट के लिए इस सर्टिफ़िकेट पर भरोसा करता है।',
      back: 'सुरक्षित पेज पर वापस जाएं',
      proceed: 'आगे बढ़ें (असुरक्षित)'
    },
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
    httpAuth: {
      eyebrow: 'サインイン',
      headline: '{origin} にサインイン',
      notPrivate: 'このサイトへの接続は保護されていません。ネットワーク上の誰でも、ユーザー名とパスワードを読み取れます。',
      workspace: 'Hronaut を終了するまで、「{workspace}」ワークスペースでこのウェブサイトにサインインしたままになります。',
      sent: 'Hronaut はユーザー名とパスワードをこのウェブサイトにだけ送信し、エージェントに表示することはありません。',
      username: 'ユーザー名',
      password: 'パスワード',
      signIn: 'サインイン'
    },
    certificate: {
      eyebrow: '保護されていない接続',
      headline: '{host} にアクセスしますか？',
      authority: 'このサイトのセキュリティ証明書は、このコンピュータが信頼する認証局から発行されていません。',
      name: 'このサイトのセキュリティ証明書は別のウェブサイトのものです。',
      date: 'このサイトのセキュリティ証明書は期限切れか、まだ有効になっていません。',
      other: 'このサイトのセキュリティ証明書を検証できません。',
      risk: 'ネットワーク上の誰かがこのウェブサイトになりすまし、パスワードなど送信する内容を読み取ろうとしている可能性があります。',
      workspace: 'Hronaut を終了するまで、「{workspace}」ワークスペースではこのウェブサイトのこの証明書を信頼し、ワークスペースのエージェントもこのサイトを開けるようになります。',
      session: 'Hronaut を終了するまで、このウェブサイトのこの証明書を信頼します。',
      back: '安全なページに戻る',
      proceed: 'アクセスする（安全ではありません）'
    },
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
    httpAuth: {
      eyebrow: '로그인',
      headline: '{origin}에 로그인',
      notPrivate: '이 사이트와의 연결은 비공개가 아닙니다. 네트워크의 누구나 사용자 이름과 비밀번호를 읽을 수 있습니다.',
      workspace: 'Hronaut을 종료할 때까지 ‘{workspace}’ 작업 공간에서 이 웹사이트에 로그인된 상태가 유지됩니다.',
      sent: 'Hronaut은 사용자 이름과 비밀번호를 이 웹사이트에만 보내며, 에이전트에게 절대 보여 주지 않습니다.',
      username: '사용자 이름',
      password: '비밀번호',
      signIn: '로그인'
    },
    certificate: {
      eyebrow: '비공개 아님',
      headline: '{host}(으)로 이동할까요?',
      authority: '이 사이트의 보안 인증서는 이 컴퓨터가 신뢰하는 기관에서 발급되지 않았습니다.',
      name: '이 사이트의 보안 인증서는 다른 웹사이트의 것입니다.',
      date: '이 사이트의 보안 인증서가 만료되었거나 아직 유효하지 않습니다.',
      other: '이 사이트의 보안 인증서를 확인할 수 없습니다.',
      risk: '네트워크상의 누군가가 이 웹사이트인 척하며 비밀번호처럼 보내는 내용을 읽으려고 할 수 있습니다.',
      workspace: 'Hronaut을 종료할 때까지 ‘{workspace}’ 작업 공간에서 이 웹사이트의 이 인증서를 신뢰하며, 작업 공간의 에이전트도 이 사이트를 열 수 있습니다.',
      session: 'Hronaut을 종료할 때까지 이 웹사이트의 이 인증서를 신뢰합니다.',
      back: '안전한 페이지로 돌아가기',
      proceed: '이동(안전하지 않음)'
    },
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
    httpAuth: {
      eyebrow: '登录',
      headline: '登录到 {origin}',
      notPrivate: '您与此网站之间的连接不是私密连接。网络上的任何人都能读取您的用户名和密码。',
      workspace: '在 Hronaut 退出前，您会在“{workspace}”工作区中保持此网站的登录状态。',
      sent: 'Hronaut 只会将您的用户名和密码发送给此网站，绝不会向智能体显示。',
      username: '用户名',
      password: '密码',
      signIn: '登录'
    },
    certificate: {
      eyebrow: '连接不私密',
      headline: '要继续前往 {host} 吗？',
      authority: '其安全证书并非来自此计算机信任的颁发机构。',
      name: '其安全证书属于另一个网站。',
      date: '其安全证书已过期或尚未生效。',
      other: '无法验证其安全证书。',
      risk: '网络上可能有人在冒充此网站，以读取您发送给它的内容，例如密码。',
      workspace: '在 Hronaut 退出前，Hronaut 会在“{workspace}”工作区中为此网站信任此证书，该工作区中的智能体也可以打开它。',
      session: '在 Hronaut 退出前，Hronaut 会为此网站信任此证书。',
      back: '返回安全连接',
      proceed: '继续前往（不安全）'
    },
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
    httpAuth: {
      eyebrow: '登入',
      headline: '登入 {origin}',
      notPrivate: '你與這個網站之間的連線不是私人連線。網路上的任何人都能讀取你的使用者名稱和密碼。',
      workspace: '在 Hronaut 結束前，你會在「{workspace}」工作區中保持這個網站的登入狀態。',
      sent: 'Hronaut 只會將你的使用者名稱和密碼傳送給這個網站，絕不會向代理程式顯示。',
      username: '使用者名稱',
      password: '密碼',
      signIn: '登入'
    },
    certificate: {
      eyebrow: '非私人連線',
      headline: '要繼續前往 {host} 嗎？',
      authority: '其安全性憑證並非來自這部電腦信任的憑證授權單位。',
      name: '其安全性憑證屬於另一個網站。',
      date: '其安全性憑證已過期或尚未生效。',
      other: '無法驗證其安全性憑證。',
      risk: '網路上可能有人假冒這個網站，以讀取你傳送給它的內容，例如密碼。',
      workspace: '在 Hronaut 結束前，Hronaut 會在「{workspace}」工作區中為這個網站信任這個憑證，工作區中的代理程式也能開啟它。',
      session: '在 Hronaut 結束前，Hronaut 會為這個網站信任這個憑證。',
      back: '返回安全性頁面',
      proceed: '繼續前往（不安全）'
    },
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
  'id-ID': {
    close: 'Tutup',
    httpAuth: {
      eyebrow: 'Masuk',
      headline: 'Masuk ke {origin}',
      notPrivate: 'Koneksi Anda ke situs ini tidak pribadi. Siapa pun di jaringan dapat membaca nama pengguna dan sandi Anda.',
      workspace: 'Anda tetap masuk ke situs ini di ruang kerja “{workspace}” sampai Hronaut ditutup.',
      sent: 'Hronaut mengirim nama pengguna dan sandi Anda hanya ke situs ini dan tidak pernah menampilkannya kepada agen.',
      username: 'Nama pengguna',
      password: 'Sandi',
      signIn: 'Masuk'
    },
    certificate: {
      eyebrow: 'Tidak pribadi',
      headline: 'Lanjutkan ke {host}?',
      authority: 'Sertifikat keamanannya bukan dari otoritas yang dipercaya komputer ini.',
      name: 'Sertifikat keamanannya milik situs lain.',
      date: 'Sertifikat keamanannya sudah kedaluwarsa atau belum berlaku.',
      other: 'Sertifikat keamanannya tidak dapat diverifikasi.',
      risk: 'Seseorang di jaringan mungkin menyamar sebagai situs ini untuk membaca apa yang Anda kirim ke situs ini, seperti sandi.',
      workspace: 'Hronaut memercayai sertifikat ini untuk situs ini di ruang kerja “{workspace}” sampai Hronaut ditutup, dan agen di ruang kerja juga dapat membukanya.',
      session: 'Hronaut memercayai sertifikat ini untuk situs ini sampai Hronaut ditutup.',
      back: 'Kembali ke tempat aman',
      proceed: 'Lanjutkan (tidak aman)'
    },
    savePassword: {
      eyebrow: 'Sandi tersimpan',
      save: 'Simpan sandi Anda untuk {origin}?',
      update: 'Perbarui sandi tersimpan Anda untuk {origin}?',
      username: 'Nama pengguna',
      noUsername: 'Halaman tidak mengirimkan nama pengguna bersama sandi ini.',
      stored: 'Hronaut mengenkripsinya dengan penyimpanan aman sistem operasi Anda. Sandi tersimpan tidak pernah diekspos melalui MCP.'
    },
    walletRecovery: {
      eyebrow: 'Dompet baru',
      headline: 'Catat frasa pemulihan untuk {wallet}',
      phrase: 'Frasa pemulihan',
      keep: 'Catat kata-kata ini secara berurutan dan simpan secara offline. Siapa pun yang memilikinya dapat mengontrol dompet ini.',
      added: 'Hronaut menambahkan dompet setelah Anda mengonfirmasi bahwa kata-kata tersebut sudah disimpan.'
    },
    claudeSetup: {
      file: 'File',
      added: 'Entri baru di "mcpServers"',
      replaces: 'Entri yang digantikan'
    },
    sitePermission: {
      embeddedIn: 'Disematkan di {site}',
      wants: {
        camera: '{origin} ingin menggunakan kamera Anda',
        microphone: '{origin} ingin menggunakan mikrofon Anda',
        cameraAndMicrophone: '{origin} ingin menggunakan kamera dan mikrofon Anda',
        geolocation: '{origin} ingin mengetahui lokasi Anda',
        notifications: '{origin} ingin menampilkan notifikasi',
        clipboardRead: '{origin} ingin melihat teks dan gambar yang Anda salin',
        clipboardWrite: '{origin} ingin menyalin teks dan gambar ke papan klip Anda',
        midiSysex: '{origin} ingin mengontrol dan memprogram ulang perangkat MIDI Anda',
        fileSystem: '{origin} ingin menggunakan file atau folder di komputer Anda',
        openExternal: '{origin} ingin membuka aplikasi di komputer Anda',
        fullscreen: '{origin} ingin menggunakan layar penuh',
        idleDetection: '{origin} ingin mengetahui kapan Anda menggunakan perangkat ini',
        keyboardLock: '{origin} ingin mengambil alih pintasan keyboard Anda',
        pointerLock: '{origin} ingin mengunci dan menyembunyikan kursor mouse Anda',
        persistentStorage: '{origin} ingin menyimpan data secara permanen di perangkat ini',
        screenWakeLock: '{origin} ingin membuat layar Anda tetap menyala',
        storageAccess: '{origin} ingin menggunakan cookie dan data situsnya di halaman ini',
        topLevelStorageAccess: '{origin} ingin menggunakan cookie dan data situs dari situs terkait',
        windowManagement: '{origin} ingin mengelola jendela di semua layar Anda',
        displayCapture: '{origin} ingin melihat layar Anda',
        other: '{origin} ingin menggunakan “{permission}”'
      }
    }
  },
  'vi-VN': {
    close: 'Đóng',
    httpAuth: {
      eyebrow: 'Đăng nhập',
      headline: 'Đăng nhập vào {origin}',
      notPrivate: 'Kết nối của bạn với trang web này không riêng tư. Bất kỳ ai trên mạng cũng có thể đọc tên người dùng và mật khẩu của bạn.',
      workspace: 'Bạn vẫn đăng nhập trang web này trong không gian làm việc “{workspace}” cho đến khi Hronaut thoát.',
      sent: 'Hronaut chỉ gửi tên người dùng và mật khẩu của bạn đến trang web này và không bao giờ hiển thị chúng cho tác nhân.',
      username: 'Tên người dùng',
      password: 'Mật khẩu',
      signIn: 'Đăng nhập'
    },
    certificate: {
      eyebrow: 'Không riêng tư',
      headline: 'Tiếp tục truy cập {host}?',
      authority: 'Chứng chỉ bảo mật của trang không do một tổ chức mà máy tính này tin cậy cấp.',
      name: 'Chứng chỉ bảo mật của trang thuộc về một trang web khác.',
      date: 'Chứng chỉ bảo mật của trang đã hết hạn hoặc chưa có hiệu lực.',
      other: 'Không thể xác minh chứng chỉ bảo mật của trang.',
      risk: 'Ai đó trên mạng có thể đang giả mạo trang web này để đọc những gì bạn gửi đến, chẳng hạn như mật khẩu.',
      workspace: 'Hronaut tin cậy chứng chỉ này cho trang web này trong không gian làm việc “{workspace}” cho đến khi Hronaut thoát, và các tác nhân trong không gian làm việc cũng có thể mở trang.',
      session: 'Hronaut tin cậy chứng chỉ này cho trang web này cho đến khi Hronaut thoát.',
      back: 'Quay lại an toàn',
      proceed: 'Tiếp tục (không an toàn)'
    },
    savePassword: {
      eyebrow: 'Mật khẩu đã lưu',
      save: 'Lưu mật khẩu của bạn cho {origin}?',
      update: 'Cập nhật mật khẩu đã lưu của bạn cho {origin}?',
      username: 'Tên người dùng',
      noUsername: 'Trang không gửi kèm tên người dùng.',
      stored: 'Hronaut mã hóa mật khẩu bằng bộ nhớ bảo mật của hệ điều hành. Mật khẩu đã lưu không bao giờ bị lộ qua MCP.'
    },
    walletRecovery: {
      eyebrow: 'Ví mới',
      headline: 'Ghi lại cụm từ khôi phục cho {wallet}',
      phrase: 'Cụm từ khôi phục',
      keep: 'Hãy ghi lại các từ này theo đúng thứ tự và cất giữ ngoại tuyến. Bất kỳ ai có các từ này đều kiểm soát được ví.',
      added: 'Hronaut sẽ thêm ví sau khi bạn xác nhận đã lưu các từ này.'
    },
    claudeSetup: {
      file: 'Tệp',
      added: 'Mục mới trong "mcpServers"',
      replaces: 'Mục bị thay thế'
    },
    sitePermission: {
      embeddedIn: 'Được nhúng trong {site}',
      wants: {
        camera: '{origin} muốn sử dụng máy ảnh của bạn',
        microphone: '{origin} muốn sử dụng micrô của bạn',
        cameraAndMicrophone: '{origin} muốn sử dụng máy ảnh và micrô của bạn',
        geolocation: '{origin} muốn biết vị trí của bạn',
        notifications: '{origin} muốn hiển thị thông báo',
        clipboardRead: '{origin} muốn xem văn bản và hình ảnh mà bạn sao chép',
        clipboardWrite: '{origin} muốn sao chép văn bản và hình ảnh vào bảng nhớ tạm của bạn',
        midiSysex: '{origin} muốn điều khiển và lập trình lại các thiết bị MIDI của bạn',
        fileSystem: '{origin} muốn sử dụng một tệp hoặc thư mục trên máy tính của bạn',
        openExternal: '{origin} muốn mở một ứng dụng trên máy tính của bạn',
        fullscreen: '{origin} muốn sử dụng toàn màn hình',
        idleDetection: '{origin} muốn biết khi nào bạn đang sử dụng thiết bị này',
        keyboardLock: '{origin} muốn chặn và sử dụng các phím tắt của bạn',
        pointerLock: '{origin} muốn khóa và ẩn con trỏ chuột của bạn',
        persistentStorage: '{origin} muốn lưu trữ dữ liệu vĩnh viễn trên thiết bị này',
        screenWakeLock: '{origin} muốn giữ cho màn hình của bạn luôn bật',
        storageAccess: '{origin} muốn sử dụng cookie và dữ liệu trang web của mình trên trang này',
        topLevelStorageAccess: '{origin} muốn sử dụng cookie và dữ liệu trang web của các trang web có liên quan',
        windowManagement: '{origin} muốn quản lý cửa sổ trên tất cả màn hình của bạn',
        displayCapture: '{origin} muốn xem màn hình của bạn',
        other: '{origin} muốn sử dụng “{permission}”'
      }
    }
  }
}

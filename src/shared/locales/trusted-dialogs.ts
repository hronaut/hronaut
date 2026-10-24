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
      replaces: 'It replaces'
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
      replaces: 'Він замінить'
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
      replaces: 'Она заменит'
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
      replaces: 'Er ersetzt'
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
      replaces: 'Elle remplace'
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
      replaces: 'Sustituye'
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
      replaces: 'Zastąpi'
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
  }
}

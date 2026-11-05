export const esESTrustedDialogs = {
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
      midi: '{origin} quiere usar tus dispositivos MIDI',
      localFonts: '{origin} quiere usar las fuentes de tu ordenador',
      localNetwork: '{origin} quiere buscar dispositivos de tu red local y conectarse a ellos',
      loopbackNetwork: '{origin} quiere conectarse a aplicaciones y servicios de este dispositivo',
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
}

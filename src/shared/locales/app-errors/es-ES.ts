import type { AppErrorMessages } from './en-US.js'

export const esESAppErrors: AppErrorMessages = {
  "startup": {
    "initializing": "Los espacios de trabajo guardados aún se están cargando. Inténtalo de nuevo cuando termine el inicio.",
    "unavailable": "Los espacios de trabajo guardados no están disponibles.",
    "readUnavailable": "El espacio de trabajo ya no se puede leer.",
    "tooManyReads": "Hay demasiadas lecturas de espacios de trabajo pendientes.",
    "metadataUnavailable": "Los metadatos de los espacios de trabajo guardados no están disponibles ({reason}). El inicio se detuvo para conservar las opciones de recuperación."
  },
  "sleep": {
    "onlyWebsites": "Solo se pueden suspender las pestañas de sitios web inactivas.",
    "visible": "No se puede suspender una pestaña visible.",
    "pinned": "Las pestañas fijadas permanecen activas.",
    "pageHold": "Una pestaña con la página retenida de forma explícita permanece activa.",
    "loading": "No se puede suspender una pestaña que se está cargando.",
    "audio": "Una pestaña que reproduce audio permanece activa.",
    "dialog": "Una pestaña con un cuadro de diálogo abierto permanece activa.",
    "wallet": "Una pestaña que espera una solicitud del monedero permanece activa.",
    "devTools": "Una pestaña con las herramientas de desarrollo abiertas permanece activa.",
    "interaction": "Una pestaña con una interacción en curso permanece activa.",
    "video": "Una pestaña que graba vídeo permanece activa.",
    "repro": "Una pestaña que graba pasos de reproducción permanece activa.",
    "domChanges": "Una pestaña que graba cambios del DOM permanece activa.",
    "liveRegion": "Una pestaña que graba una región dinámica permanece activa.",
    "cssState": "Una pestaña con un estado CSS forzado permanece activa.",
    "domMutationSource": "Una pestaña que captura el origen de un cambio del DOM permanece activa.",
    "passkey": "Una pestaña con una llave de acceso virtual permanece activa.",
    "logpoints": "Una pestaña con logpoints activos permanece activa.",
    "coverage": "Una pestaña que graba la cobertura de código permanece activa.",
    "cpuProfile": "Una pestaña que graba un perfil de CPU de JavaScript permanece activa.",
    "memory": "Una pestaña que graba asignaciones de memoria permanece activa.",
    "mcpCommand": "Una pestaña con un comando MCP en curso permanece activa.",
    "download": "Una pestaña con una descarga en curso permanece activa.",
    "render": "Una pestaña que crea una captura de página o un PDF permanece activa.",
    "unsavedForm": "Esta pestaña tiene un formulario a medio rellenar y permanece activa para no perder los datos sin guardar."
  },
  "splitView": {
    "sameTab": "Elige otra pestaña para la vista dividida.",
    "home": "El inicio de Hronaut no se puede abrir en la vista dividida.",
    "currentUnavailable": "La pestaña actual ya no funciona. Ciérrala y vuelve a abrirla desde Cerradas recientemente.",
    "selectedUnavailable": "La pestaña seleccionada ya no funciona. Ciérrala y vuelve a abrirla desde Cerradas recientemente.",
    "notOpen": "La vista dividida no está abierta."
  },
  "clipboard": {
    "textTooLarge": "El texto es demasiado grande para copiarlo de forma segura (máximo 8 MB).",
    "textRejected": "El texto se preparó, pero el portapapeles del sistema no lo aceptó.",
    "screenshotRejected": "La captura de pantalla se tomó, pero el portapapeles del sistema no aceptó la imagen.",
    "pageClosed": "La página se cerró antes de que se pudiera copiar su imagen.",
    "imageRejected": "La imagen de la página se seleccionó, pero el portapapeles del sistema no la aceptó."
  },
  "tabs": {
    "noActiveTab": "No hay ninguna pestaña activa.",
    "rendererUnavailable": "Esta pestaña ya no responde. Ciérrala y vuelve a abrirla desde Cerradas recientemente.",
    "limit": "Se alcanzó el límite de pestañas ({max}).",
    "homeNotPinned": "El inicio de Hronaut no se puede fijar.",
    "homeNotReordered": "El inicio de Hronaut no se puede mover.",
    "pinnedBoundary": "Fija o deja de fijar la pestaña antes de moverla entre las pestañas fijadas y las demás.",
    "otherWorkspace": "Las pestañas solo se pueden reordenar dentro del mismo espacio de trabajo.",
    "homeNotDuplicated": "El inicio de Hronaut no se puede duplicar.",
    "homeInAgentWorkspace": "El inicio de Hronaut es una página de la aplicación para personas y no se puede añadir a un espacio de trabajo de agente.",
    "workspaceCleanupFailed": "No se pudo abrir la nueva pestaña ni limpiar su espacio de trabajo. El espacio de trabajo sigue disponible para recuperarlo."
  },
  "page": {
    "rendererExitedDuringAction": "La página se detuvo durante esta acción porque su proceso terminó; se desconocen sus efectos. Recarga o cierra la pestaña y comprueba su estado actual.",
    "rendererExitedBeforeAction": "La página no se está ejecutando porque su proceso terminó; no se le envió nada. Recarga o cierra la pestaña y comprueba su estado actual.",
    "closedWhileWaiting": "La pestaña se cerró mientras se esperaba la página.",
    "rendererLostWhileWaiting": "La pestaña dejó de responder mientras se esperaba la página.",
    "loadTimedOut": "Se agotó el tiempo de espera para que la página terminara de cargarse.",
    "zoomPercent": "El zoom de la página debe ser un número entero entre 50 y 400 por ciento.",
    "findQuery": "La búsqueda debe tener entre 1 y 1000 caracteres."
  },
  "loadFailure": {
    "nameNotResolved": "No se pudo encontrar la dirección del sitio web ({code}).",
    "connectionRefused": "El sitio web rechazó la conexión ({code}).",
    "offline": "Parece que el dispositivo no tiene conexión ({code}).",
    "timedOut": "El sitio web tardó demasiado en responder ({code}).",
    "connectionReset": "La conexión se restableció al cargar la página ({code}).",
    "certificate": "Hronaut no confía en el certificado de seguridad de este sitio web ({code})."
  },
  "navigation": {
    "homeInAgentWorkspace": "El inicio de Hronaut es una página de la aplicación para personas y no se puede abrir en un espacio de trabajo de agente.",
    "agentSchemes": "Los espacios de trabajo de agentes no pueden abrir direcciones del navegador locales, privilegiadas ni con credenciales.",
    "originBlocked": "La navegación a {origin} está bloqueada en este espacio de trabajo. Permite este origen en la configuración Acceso a sitios del espacio de trabajo de confianza.",
    "observerOrigin": "El origen de un observador público no se puede cambiar ni ampliar.",
    "recoveryRunning": "La pestaña ya se está recuperando.",
    "recoveryPageChanged": "La página cambió mientras se recuperaba la pestaña.",
    "recoveryTabClosed": "La pestaña se cerró mientras se recuperaba.",
    "recoveryTimedOut": "No se pudo recuperar la pestaña a tiempo."
  },
  "workspace": {
    "unavailable": "El espacio de trabajo ya no está disponible.",
    "busyArchiving": "El espacio de trabajo «{name}» se está archivando. Vuelve a intentarlo cuando termine la operación.",
    "busyClosing": "El espacio de trabajo «{name}» se está cerrando. Vuelve a intentarlo cuando termine la operación.",
    "busyForking": "Se está creando una copia del espacio de trabajo «{name}». Vuelve a intentarlo cuando termine la operación.",
    "busyRestoring": "El espacio de trabajo «{name}» se está restaurando desde el archivo. Vuelve a intentarlo cuando termine la operación.",
    "busyClearingData": "Se están borrando los datos de sitios del espacio de trabajo «{name}». Vuelve a intentarlo cuando termine la operación.",
    "busyMovingData": "Se están moviendo los datos del espacio de trabajo «{name}». Vuelve a intentarlo cuando termine la operación.",
    "busyCopyingData": "Se están copiando los datos del espacio de trabajo «{name}». Vuelve a intentarlo cuando termine la operación.",
    "busyImportingCookies": "Se están importando cookies del navegador al espacio de trabajo «{name}». Vuelve a intentarlo cuando termine la operación."
  },
  "lifecycle": {
    "homeTab": "Solo se pueden congelar o reanudar las pestañas con páginas en ejecución.",
    "sleeping": "Reactiva la pestaña suspendida antes de cambiar el estado de su página.",
    "rendererUnavailable": "La pestaña no responde en este momento.",
    "closedWhileChanging": "La pestaña se cerró mientras se cambiaba el estado de su página.",
    "closedBeforeDispatch": "La pestaña se cerró antes de enviar la orden para cambiar el estado de la página.",
    "documentChanged": "La página cambió antes de enviar la orden para cambiar su estado.",
    "devTools": "Cierra las herramientas de desarrollo de esta pestaña antes de cambiar el estado de su página."
  },
  "inputLock": {
    "pageBusy": "Una página está ocupada. Los bloqueos de entrada no cambiaron. Espera a que termine su operación y vuelve a intentarlo.",
    "observer": "La entrada de la página sigue bloqueada en un espacio de trabajo de observador público de solo lectura.",
    "tabClosed": "La pestaña se cerró antes de que cambiara su bloqueo de entrada.",
    "tabNotRestored": "No se pudo cambiar ni restaurar el bloqueo de entrada de esta pestaña.",
    "allNotRestored": "No se pudo cambiar ni restaurar el bloqueo de entrada global en todas las pestañas.",
    "allNotUpdated": "No se pudo cambiar el bloqueo de entrada global en todas las pestañas."
  },
  "agentPause": {
    "serviceUnavailable": "El servicio de agentes no está disponible."
  },
  "devTools": {
    "targetChanged": "La pestaña cambió antes de abrir las herramientas de desarrollo.",
    "conditionsPending": "Las condiciones de solicitud aún se están aplicando. Espera a que terminen antes de abrir las herramientas de desarrollo.",
    "conditionsChanged": "Las condiciones de solicitud cambiaron antes de abrir las herramientas de desarrollo."
  },
  "bookmarks": {
    "invalidUrl": "La dirección del marcador debe ser una dirección HTTP o HTTPS de hasta 4096 caracteres codificados.",
    "limit": "Se alcanzó el límite de marcadores ({max}).",
    "duplicate": "Esta dirección ya está en marcadores.",
    "unavailable": "El marcador ya no está disponible.",
    "collectionLimit": "Se alcanzó el límite de colecciones (50).",
    "collectionMissing": "No se encontró la colección de marcadores.",
    "collectionNameTaken": "Ya existe una colección de marcadores con este nombre.",
    "collectionName": "El nombre de la colección debe tener entre 1 y 80 caracteres.",
    "storageUnavailable": "El almacenamiento de marcadores no está disponible.",
    "historyUnavailable": "El historial de visitas no está disponible."
  },
  "startupScreen": {
    "title": "Hronaut no se pudo iniciar",
    "description": "La interfaz de la aplicación no pudo cargar su configuración inicial.",
    "retry": "Reintentar",
    "privacy": "Tu perfil del navegador permanece en este dispositivo.",
    "settingsUnavailable": "El servicio de configuración de la interfaz no está disponible."
  }
}

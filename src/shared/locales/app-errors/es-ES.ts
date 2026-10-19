import type { AppErrorMessages } from './en-US.js'

export const esESAppErrors: AppErrorMessages = {
  "startup": {
    "initializing": "Los espacios de trabajo guardados aún se están cargando. Inténtalo de nuevo cuando termine el inicio.",
    "unavailable": "Los espacios de trabajo guardados no están disponibles.",
    "readUnavailable": "El espacio de trabajo ya no se puede leer.",
    "tooManyReads": "Hay demasiadas lecturas de espacios de trabajo pendientes."
  },
  "sleep": {
    "onlyWebsites": "Solo se pueden suspender las pestañas de sitios web inactivas.",
    "visible": "No se puede suspender una pestaña visible.",
    "pinned": "Las pestañas fijadas permanecen activas.",
    "pageHold": "Una pestaña cuya página se mantiene activa de forma explícita permanece activa.",
    "loading": "No se puede suspender una pestaña que se está cargando.",
    "audio": "Una pestaña que reproduce audio permanece activa.",
    "dialog": "Una pestaña con un cuadro de diálogo abierto permanece activa.",
    "wallet": "Una pestaña que espera una solicitud de la cartera permanece activa.",
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
    "currentUnavailable": "La pestaña actual ya no responde. Ciérrala y vuelve a abrirla desde Cerradas recientemente.",
    "selectedUnavailable": "La pestaña seleccionada ya no responde. Ciérrala y vuelve a abrirla desde Cerradas recientemente.",
    "notOpen": "La vista dividida no está abierta."
  },
  "clipboard": {
    "textTooLarge": "El texto es demasiado grande para copiarlo de forma segura (máximo 8 MB).",
    "textRejected": "El texto se preparó, pero el portapapeles del sistema no lo aceptó.",
    "screenshotRejected": "La captura de pantalla se tomó, pero el portapapeles del sistema no aceptó la imagen.",
    "pageClosed": "La página se cerró antes de que se pudiera copiar su imagen.",
    "imageRejected": "La imagen de la página se seleccionó, pero el portapapeles del sistema no la aceptó."
  },
  "startupScreen": {
    "title": "Hronaut no se pudo iniciar",
    "description": "La interfaz de la aplicación no pudo cargar su configuración inicial.",
    "retry": "Reintentar",
    "privacy": "Tu perfil del navegador permanece en este dispositivo.",
    "settingsUnavailable": "El servicio de configuración de la interfaz no está disponible."
  }
}

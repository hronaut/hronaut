export const esESReportCaveats = {
  performance: {
    lcpPhases: 'Las fases del LCP son mediciones de tiempo del navegador, no una prueba de causa. Los datos que faltan o están restringidos se indican; no se atribuyen fases tras una restauración ni en navegaciones suaves.',
    localSample: 'Es una sola muestra local de la visita actual, no datos de campo ni un resultado de CrUX en el percentil 75.',
    inpUnavailable: 'El INP no está disponible hasta que la página recibe una interacción válida; algunas métricas no están disponibles en visitas en segundo plano o muy breves.',
    longAnimationFrames: 'La atribución de fotogramas de animación largos señala los puntos de entrada de los scripts, no necesariamente la función interna más lenta.',
    crossOrigin: 'Los marcos de otros orígenes, los workers, los service workers y el código de mundos aislados pueden generar trabajo sin atribución a un script.',
    userTimings: 'Los nombres de los tiempos de usuario los define la página y se depuran; se omiten los objetos de detalle arbitrarios, las pilas de llamadas y el código fuente.',
    layoutShifts: 'Se excluyen los desplazamientos de diseño ocurridos justo después de una entrada. La suma de sus puntuaciones es orientativa y puede diferir del CLS calculado por ventanas de sesión.',
    baselineUrl: 'La dirección de la referencia difiere de esta medición; compara solo si el cambio de navegación fue intencionado.',
    environment: 'El entorno del navegador difiere de la referencia; los cambios de área visible, ralentización, caché, encabezados o idioma pueden afectar a la diferencia.',
    deltas: 'Las diferencias de antes y después comparan dos muestras locales y pueden incluir la variación normal entre ejecuciones; repite las mediciones importantes en las mismas condiciones.'
  },
  accessibilityComparison: {
    urlChanged: 'La dirección de la página cambió desde la referencia de accesibilidad.',
    scopeChanged: 'Cambiaron el estándar, el selector o los límites de recopilación de la auditoría; establece una nueva referencia para este alcance.',
    engineChanged: 'Cambió el motor de auditoría; establece una nueva referencia antes de comparar hallazgos.',
    baselineTruncated: 'La referencia se truncó, así que los hallazgos nuevos no se pueden determinar con seguridad.',
    currentTruncated: 'La auditoría actual se truncó, así que los hallazgos resueltos no se pueden determinar con seguridad.'
  },
  indexedDb: {
    origin: 'Solo se incluye este origen de nivel superior; no se incluyen las bases de datos de marcos de terceros.',
    snapshot: 'Las bases de datos y los registros son una instantánea. Actualiza después de que el sitio cambie IndexedDB.',
    names: 'Los nombres de bases de datos, almacenes de objetos, índices y claves los define el sitio y pueden contener datos privados.',
    longNames: 'Se omiten las bases de datos y los almacenes de objetos con nombres de más de 512 caracteres.',
    valuesIncluded: 'Las vistas previas de los registros son limitadas y pueden contener datos privados de la aplicación.',
    valuesOmitted: 'Se omiten los valores de los registros.',
    readOnly: 'Este inspector solo lee IndexedDB y nunca lo modifica ni lo borra.'
  },
  storageUsage: {
    estimates: 'El uso y la cuota son estimaciones puntuales del navegador y pueden cambiar cuando Chromium expulsa o escribe datos.',
    quota: 'La cuota es el presupuesto que Chromium indica ahora para este origen, no el espacio libre del dispositivo.',
    origin: 'Solo se incluye este origen HTTP(S) de nivel superior; el almacenamiento de terceros y el particionado pueden contabilizarse por separado.',
    aggregates: 'Solo se muestran totales en bytes y las categorías de almacenamiento del navegador. Nunca se incluyen claves, valores, nombres de archivo ni cuerpos de respuesta.',
    readOnly: 'Este inspector solo lee el uso del almacenamiento y nunca modifica ni borra datos.',
    fallback: 'El desglose detallado de la cuota de Chromium no estaba disponible, así que este informe usa la estimación general del navegador: {reason}'
  },
  storageChanges: {
    baseline: 'La referencia solo se guarda en memoria y se descarta cuando la borras, cuando la pestaña cambia de origen o se cierra, o cuando Hronaut se cierra.',
    scope: 'El almacenamiento local y las cookies se comparten por origen dentro de este espacio de trabajo y están aislados de otros espacios de trabajo; el almacenamiento de sesión pertenece solo a esta pestaña.',
    valuesIncluded: 'Los valores se muestran hasta un tamaño límite. Los valores de las cookies HttpOnly siempre siguen protegidos.',
    valuesOmitted: 'Se omiten los valores.',
    snapshot: 'La instantánea abarca las primeras 200 entradas ordenadas de cada tipo de almacenamiento. El almacenamiento también puede cambiar en segundo plano entre la referencia y la comparación.'
  },
  pwa: {
    origin: 'Solo se incluye este origen de nivel superior; no se incluyen los workers ni las cachés de marcos de terceros.',
    snapshot: 'Los registros y las entradas en caché son una instantánea. Actualiza después de que el sitio cambie su estado sin conexión.',
    manifest: 'El manifiesto se lee en unos pocos campos limitados; nunca se muestra su código fuente.',
    installabilityIds: 'Los identificadores de errores de instalación vienen de Chromium y pueden cambiar entre versiones de Chromium.',
    readOnly: 'Este inspector solo lee los datos sin conexión y nunca muestra cuerpos de respuesta en caché.',
    headersIncluded: 'Los encabezados de solicitud y respuesta se muestran hasta un límite; los encabezados reconocidos que contienen secretos se ocultan.',
    headersOmitted: 'Se omiten los valores de los encabezados.',
    opaqueSizes: 'El tamaño de las respuestas opacas puede incluir el relleno de cuota del navegador y no se mide aquí.',
    clearing: 'Este inspector nunca anula el registro de workers ni vacía cachés.',
    installabilityUnavailable: 'El diagnóstico de instalación no estaba disponible: {reason}'
  }
}

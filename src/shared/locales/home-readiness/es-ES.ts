export const esESHomeReadiness = {
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
}

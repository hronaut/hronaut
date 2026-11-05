export const ptBRHomeReadiness = {
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
}

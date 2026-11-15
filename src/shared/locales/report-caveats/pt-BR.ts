export const ptBRReportCaveats = {
  performance: {
    lcpPhases: 'As fases do LCP são observações de tempo do navegador, não provas de causa. Evidências ausentes ou restritas são indicadas explicitamente; a atribuição de fases em restaurações e em navegações suaves não é compatível.',
    localSample: 'Esta é uma única amostra local da visita atual, não dados de campo nem um resultado do CrUX no 75º percentil.',
    inpUnavailable: 'O INP fica indisponível até que a página receba uma interação qualificada; algumas métricas ficam indisponíveis em visitas em segundo plano ou de curta duração.',
    longAnimationFrames: 'A atribuição de quadros de animação longos identifica os pontos de entrada dos scripts, não necessariamente a função interna mais lenta.',
    crossOrigin: 'Frames de origem cruzada, workers, service workers e código em mundos isolados podem contribuir com trabalho sem atribuição a scripts.',
    userTimings: 'Os nomes de User Timing são criados pela página e sanitizados; objetos de detalhe arbitrários, rastreamentos de pilha e código-fonte são omitidos.',
    layoutShifts: 'As evidências de mudança de layout desconsideram entradas com entrada discreta recente. A soma das pontuações é diagnóstica e pode diferir da pontuação de CLS por janela de sessão.',
    baselineUrl: 'O URL da referência é diferente desta medição; compare somente se a mudança de navegação foi intencional.',
    environment: 'O ambiente do navegador é diferente da referência; mudanças de área de visualização, limitação, cache, cabeçalhos ou localidade podem afetar a diferença.',
    deltas: 'As diferenças de antes e depois comparam duas amostras locais e podem incluir a variação normal entre execuções; repita medições importantes em condições equivalentes.'
  },
  accessibilityComparison: {
    urlChanged: 'O URL da página mudou depois da referência de acessibilidade.',
    scopeChanged: 'O padrão de acessibilidade, o seletor ou os limites de coleta mudaram; defina uma nova referência para este escopo.',
    engineChanged: 'O mecanismo de acessibilidade mudou; defina uma nova referência antes de comparar constatações.',
    baselineTruncated: 'A referência foi truncada, então não é possível determinar com segurança as novas constatações.',
    currentTruncated: 'A auditoria atual foi truncada, então não é possível determinar com segurança as constatações resolvidas.'
  },
  indexedDb: {
    origin: 'Somente esta origem de nível superior é coberta; bancos de dados em frames de terceiros não são incluídos.',
    snapshot: 'Os bancos de dados e registros são um snapshot de um momento específico. Atualize depois que o site alterar o IndexedDB.',
    names: 'Os nomes de bancos de dados, object stores, índices e chaves são escritos pelo site e podem conter dados privados.',
    longNames: 'Bancos de dados e object stores com nomes de mais de 512 caracteres são deixados de fora.',
    valuesIncluded: 'As prévias de registros são limitadas e podem conter dados privados do aplicativo.',
    valuesOmitted: 'Os valores dos registros são deixados de fora.',
    readOnly: 'Este inspetor só lê o IndexedDB e nunca o altera nem o limpa.'
  },
  storageUsage: {
    estimates: 'O uso e a cota são estimativas do navegador em um momento específico e podem mudar à medida que o Chromium remove ou grava dados.',
    quota: 'A cota é o orçamento que o Chromium informa no momento para esta origem, não o espaço livre no dispositivo.',
    origin: 'Somente esta origem HTTP(S) de nível superior é coberta; o armazenamento de terceiros e particionado pode ser contado separadamente.',
    aggregates: 'Somente as contagens totais de bytes e as categorias de armazenamento do navegador são mostradas. Chaves, valores, nomes de arquivos e corpos de respostas nunca são incluídos.',
    readOnly: 'Este inspetor só lê o uso do armazenamento e nunca altera nem limpa dados.',
    fallback: 'O detalhamento da cota do Chromium não estava disponível, então este relatório usa a estimativa geral do navegador: {reason}'
  },
  storageChanges: {
    baseline: 'A referência fica somente na memória e é descartada quando você a limpa, quando a guia muda de origem ou é fechada, ou quando o Hronaut é encerrado.',
    scope: 'O armazenamento local e os cookies são compartilhados por origem neste espaço de trabalho e isolados dos outros espaços de trabalho; o armazenamento de sessão pertence somente a esta guia.',
    valuesIncluded: 'Os valores são mostrados até um limite de tamanho. Os valores de cookies HttpOnly sempre continuam protegidos.',
    valuesOmitted: 'Os valores são deixados de fora.',
    snapshot: 'O snapshot cobre as primeiras 200 entradas ordenadas de cada tipo de armazenamento. O armazenamento também pode mudar em segundo plano entre a referência e a comparação.'
  },
  pwa: {
    origin: 'Somente esta origem de nível superior é coberta; workers e caches em frames de terceiros não são incluídos.',
    snapshot: 'Os registros e as entradas em cache são um snapshot de um momento específico. Atualize depois que o site alterar o estado off-line.',
    manifest: 'O manifesto é lido em alguns campos limitados; o código-fonte bruto dele nunca é mostrado.',
    installabilityIds: 'Os identificadores de erros de instalabilidade vêm do Chromium e podem mudar entre versões do Chromium.',
    readOnly: 'Este inspetor só lê dados off-line e nunca mostra corpos de respostas em cache.',
    headersIncluded: 'Os cabeçalhos de solicitação e resposta são mostrados até um limite; cabeçalhos reconhecidos que contêm segredos são ocultados.',
    headersOmitted: 'Os valores dos cabeçalhos são deixados de fora.',
    opaqueSizes: 'Os tamanhos de respostas opacas podem incluir o preenchimento de cota do navegador e não são medidos aqui.',
    clearing: 'Este inspetor nunca cancela o registro de workers nem limpa caches.',
    installabilityUnavailable: 'O diagnóstico de instalabilidade não estava disponível: {reason}'
  }
}

export const trTRHomeReadiness = {
  heading: 'MCP hazırlığı',
  description: 'Tarayıcı araçlarına güvenmeden önce her sınırı ayrı ayrı doğrulayın.',
  checks: {
    app: 'Uygulama',
    endpoint: 'Yerel uç nokta',
    initialization: 'İstemci başlatma',
    advertisedTools: 'Duyurulan araçlar',
    configuration: 'İstemci yapılandırması',
    clientVisibility: 'Etkin istemcide görünen araçlar',
    probe: 'Salt okunur yoklama'
  },
  inventory: 'Etkin istemcinin gösterdiği araç listesini yapıştırın',
  inventoryPlaceholder: 'browser_* veya wallet_* araç adlarını içeren istemci çıktısını yapıştırın',
  verifyInventory: 'Araç listesini karşılaştır',
  copyReport: 'Tanılamayı kopyala',
  reportLabel: 'Kopyalaması güvenli MCP hazırlık tanılaması',
  privacy: 'Karşılaştırma bu sayfada kalır. Kopyalanan rapor yalnızca türlendirilmiş durumları, sayıları, sınırlı sayıda araç adını ve zaman damgalarını içerir.',
  nextAction: {
    start_honaut: 'Yerel Hronaut dinleyicisini başlatın veya onarın.',
    connect_client: 'Etkin MCP istemcisini yeniden bağlayın ve başlatmanın tamamlanmasını bekleyin.',
    verify_client_configuration: 'Etkin istemcinin yapılandırmasında bu uç noktayı ve kimlik doğrulamayı onaylayın.',
    list_tools_in_active_client: 'Etkin istemcideki araçları listeleyin ve burada karşılaştırın.',
    run_read_only_probe: 'Göreve ait bir çalışma alanında browser_status veya browser_snapshot aracını bir kez çağırın.',
    retry_read_only_probe: 'Etkin istemcideki hatayı inceleyin, ardından salt okunur yoklamayı bir kez daha deneyin.',
    none: 'Bu denetim için işlem gerekmiyor.'
  }
}

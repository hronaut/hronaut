export const trTRReportCaveats = {
  performance: {
    lcpPhases: 'LCP aşamaları tarayıcı zamanlama gözlemleridir, nedensellik kanıtı değildir. Eksik veya kısıtlı kanıtlar açıkça belirtilir; geri yükleme ve soft navigation aşama ilişkilendirmesi desteklenmez.',
    localSample: 'Bu, geçerli ziyarete ait tek bir yerel örnektir; saha verisi veya 75. yüzdelik CrUX sonucu değildir.',
    inpUnavailable: 'INP, sayfa uygun bir etkileşim alana kadar kullanılamaz; arka planda kalan veya kısa süren ziyaretlerde bazı metrikler kullanılamaz.',
    longAnimationFrames: 'Uzun animasyon karesi ilişkilendirmesi, en yavaş iç işlevi değil, komut dosyası giriş noktalarını belirler.',
    crossOrigin: 'Kaynaklar arası çerçeveler, worker’lar, service worker’lar ve yalıtılmış dünya kodu, komut dosyası ilişkilendirmesi olmadan iş yüküne katkıda bulunabilir.',
    userTimings: 'User Timing adları sayfa tarafından yazılır ve temizlenir; rastgele ayrıntı nesneleri, yığın izleri ve kaynak kodu çıkarılır.',
    layoutShifts: 'Düzen kayması kanıtı, yakın zamanda ayrık giriş yapılan girdileri hariç tutar. Puan toplamı tanılama amaçlıdır ve CLS oturum penceresi puanlamasından farklı olabilir.',
    baselineUrl: 'Referans URL’si bu ölçümden farklı; yalnızca gezinme değişikliği bilinçliyse karşılaştırın.',
    environment: 'Tarayıcı ortamı referanstan farklı; görüntü alanı, kısıtlama, önbellek, başlık veya yerel ayar değişiklikleri farkı etkileyebilir.',
    deltas: 'Önce ve sonra farkları iki yerel örneği karşılaştırır ve çalıştırmalar arasındaki olağan değişimi içerebilir; önemli ölçümleri aynı koşullar altında tekrarlayın.'
  },
  accessibilityComparison: {
    urlChanged: 'Erişilebilirlik referansından sonra sayfa URL’si değişti.',
    scopeChanged: 'Erişilebilirlik standardı, seçici veya toplama sınırları değişti; bu kapsam için yeni bir referans belirleyin.',
    engineChanged: 'Erişilebilirlik motoru değişti; bulguları karşılaştırmadan önce yeni bir referans belirleyin.',
    baselineTruncated: 'Referans kısaltıldığı için yeni bulgular güvenli şekilde belirlenemez.',
    currentTruncated: 'Geçerli denetim kısaltıldığı için çözülen bulgular güvenli şekilde belirlenemez.'
  },
  indexedDb: {
    origin: 'Yalnızca bu üst düzey kaynak kapsanır; üçüncü taraf çerçevelerdeki veritabanları dahil değildir.',
    snapshot: 'Veritabanları ve kayıtlar belirli bir andaki anlık görüntüdür. Web sitesi IndexedDB’yi değiştirdikten sonra yenileyin.',
    names: 'Veritabanı, nesne deposu, dizin ve anahtar adlarını web sitesi yazar; bu adların kendisi de özel veriler içerebilir.',
    longNames: 'Adı 512 karakterden uzun olan veritabanları ve nesne depoları dışarıda bırakılır.',
    valuesIncluded: 'Kayıt önizlemeleri sınırlıdır ve özel uygulama verileri içerebilir.',
    valuesOmitted: 'Kayıt değerleri dışarıda bırakılır.',
    readOnly: 'Bu denetçi IndexedDB’yi yalnızca okur; hiçbir zaman değiştirmez veya temizlemez.'
  },
  storageUsage: {
    estimates: 'Kullanım ve kota, belirli bir andaki tarayıcı tahminleridir; Chromium veri çıkardıkça veya yazdıkça değişebilir.',
    quota: 'Kota, Chromium’un bu kaynak için şu anda bildirdiği bütçedir; cihazdaki boş alan değildir.',
    origin: 'Yalnızca bu üst düzey HTTP(S) kaynağı kapsanır; üçüncü taraf ve bölümlenmiş depolama ayrı sayılabilir.',
    aggregates: 'Yalnızca toplam bayt sayıları ve tarayıcının depolama kategorileri gösterilir. Anahtarlar, değerler, dosya adları ve yanıt gövdeleri hiçbir zaman dahil edilmez.',
    readOnly: 'Bu denetçi depolama kullanımını yalnızca okur; verileri hiçbir zaman değiştirmez veya temizlemez.',
    fallback: 'Chromium’un ayrıntılı kota dökümü kullanılamadığı için bu rapor tarayıcının genel tahminini kullanıyor: {reason}'
  },
  storageChanges: {
    baseline: 'Referans yalnızca bellekte tutulur; siz temizlediğinizde, sekmenin kaynağı değiştiğinde veya sekme kapandığında ya da Hronaut’tan çıkıldığında silinir.',
    scope: 'Yerel depolama ve çerezler bu çalışma alanında kaynağa göre paylaşılır ve diğer çalışma alanlarından yalıtılır; oturum depolaması yalnızca bu sekmeye aittir.',
    valuesIncluded: 'Değerler bir boyut sınırına kadar gösterilir. HttpOnly çerez değerleri her zaman korunur.',
    valuesOmitted: 'Değerler dışarıda bırakılır.',
    snapshot: 'Anlık görüntü, her depolama türünün sıralanmış ilk 200 girişini kapsar. Depolama, referans ile karşılaştırma arasında arka planda da değişebilir.'
  },
  pwa: {
    origin: 'Yalnızca bu üst düzey kaynak kapsanır; üçüncü taraf çerçevelerdeki worker’lar ve önbellekler dahil değildir.',
    snapshot: 'Kayıtlar ve önbelleğe alınmış girişler belirli bir andaki anlık görüntüdür. Web sitesi çevrimdışı durumunu değiştirdikten sonra yenileyin.',
    manifest: 'Manifest, sınırlı sayıda alana okunur; ham kaynağı hiçbir zaman gösterilmez.',
    installabilityIds: 'Yüklenebilirlik hatası tanımlayıcıları Chromium’dan gelir ve Chromium sürümleri arasında değişebilir.',
    readOnly: 'Bu denetçi çevrimdışı verileri yalnızca okur; önbelleğe alınmış yanıt gövdelerini hiçbir zaman göstermez.',
    headersIncluded: 'İstek ve yanıt başlıkları bir sınıra kadar gösterilir; gizli bilgi taşıdığı bilinen başlıklar gizlenir.',
    headersOmitted: 'Başlık değerleri dışarıda bırakılır.',
    opaqueSizes: 'Opak yanıtların boyutları tarayıcının kota dolgusunu içerebilir ve burada ölçülmez.',
    clearing: 'Bu denetçi hiçbir zaman worker kayıtlarını silmez veya önbellekleri temizlemez.',
    installabilityUnavailable: 'Yüklenebilirlik tanılamaları kullanılamadı: {reason}'
  }
}

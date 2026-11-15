export const trTRReproSteps = {
  kinds: {
    navigate: 'gezinme',
    click: 'tıklama',
    input: 'giriş',
    key: 'tuş',
    scroll: 'kaydırma',
    expect: 'beklenti'
  },
  steps: {
    open: '{url} adresini açın',
    navigate: '{url} adresine gidin',
    navigateWithin: 'Sayfa içinde {url} adresine gidin',
    click: '{target} öğesini tıklayın',
    input: '{target} alanına yazın (değer kaydedilmedi)',
    key: '{target} üzerinde {key} tuşuna basın',
    scroll: 'x={x}, y={y} konumuna kaydırın',
    expect: 'Beklenen sonuç: {condition}',
    captureFailed: 'Eylemin hedefi yakalanamadı; bu eylemi elle yeniden oluşturun.',
    captureInterrupted: 'Eylem yakalama bir gezinme nedeniyle kesildi; bu eylemi elle yeniden oluşturun.'
  },
  targets: {
    input: '{type} girişi',
    labelled: '{kind} “{label}”'
  },
  conditions: {
    visible: 'görünür',
    hidden: 'gizli',
    text: 'metin',
    checked: 'işaretli',
    unchecked: 'işaretsiz',
    count: 'sayı',
    urlPath: 'URL yolu'
  }
}

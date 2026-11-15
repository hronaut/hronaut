export const idIDReproSteps = {
  kinds: {
    navigate: 'navigasi',
    click: 'klik',
    input: 'input',
    key: 'tombol',
    scroll: 'gulir',
    expect: 'ekspektasi'
  },
  steps: {
    open: 'Buka {url}',
    navigate: 'Navigasi ke {url}',
    navigateWithin: 'Navigasi di dalam halaman ke {url}',
    click: 'Klik {target}',
    input: 'Ketik di {target} (nilai tidak direkam)',
    key: 'Tekan {key} di {target}',
    scroll: 'Gulir ke x={x}, y={y}',
    expect: 'Hasil yang diharapkan: {condition}',
    captureFailed: 'Target tindakan tidak dapat direkam; buat ulang tindakan ini secara manual.',
    captureInterrupted: 'Perekaman tindakan terganggu oleh navigasi; buat ulang tindakan ini secara manual.'
  },
  targets: {
    input: 'input {type}',
    labelled: '{kind} “{label}”'
  },
  conditions: {
    visible: 'terlihat',
    hidden: 'tersembunyi',
    text: 'teks',
    checked: 'dicentang',
    unchecked: 'tidak dicentang',
    count: 'jumlah',
    urlPath: 'jalur URL'
  }
}

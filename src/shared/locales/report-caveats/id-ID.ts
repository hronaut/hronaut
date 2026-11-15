export const idIDReportCaveats = {
  performance: {
    lcpPhases: 'Fase LCP adalah pengamatan waktu browser, bukan bukti penyebab. Bukti yang tidak ada atau dibatasi dinyatakan secara eksplisit; atribusi fase untuk pemulihan dan soft navigation tidak didukung.',
    localSample: 'Ini adalah satu sampel lokal dari kunjungan saat ini, bukan data lapangan atau hasil CrUX persentil ke-75.',
    inpUnavailable: 'INP tidak tersedia hingga halaman menerima interaksi yang memenuhi syarat; beberapa metrik tidak tersedia untuk kunjungan di latar belakang atau yang singkat.',
    longAnimationFrames: 'Atribusi long animation frame mengidentifikasi titik masuk skrip, belum tentu fungsi internal yang paling lambat.',
    crossOrigin: 'Frame lintas origin, worker, service worker, dan kode isolated world dapat menyumbang pekerjaan tanpa atribusi skrip.',
    userTimings: 'Nama User Timing dibuat oleh halaman dan telah dibersihkan; objek detail arbitrer, stack trace, dan kode sumber dihilangkan.',
    layoutShifts: 'Bukti pergeseran tata letak tidak menyertakan entri dengan input diskret baru-baru ini. Jumlah skornya bersifat diagnostik dan dapat berbeda dari penilaian jendela sesi CLS.',
    baselineUrl: 'URL baseline berbeda dari pengukuran ini; bandingkan hanya jika perubahan navigasi memang disengaja.',
    environment: 'Lingkungan browser berbeda dari baseline; perubahan viewport, throttling, cache, header, atau setelan lokal dapat memengaruhi selisihnya.',
    deltas: 'Selisih sebelum dan sesudah membandingkan dua sampel lokal dan dapat mencakup variasi normal antarproses; ulangi pengukuran penting dalam kondisi yang sama.'
  },
  accessibilityComparison: {
    urlChanged: 'URL halaman berubah setelah baseline aksesibilitas.',
    scopeChanged: 'Standar aksesibilitas, selector, atau batas pengumpulan berubah; tetapkan baseline baru untuk cakupan ini.',
    engineChanged: 'Mesin aksesibilitas berubah; tetapkan baseline baru sebelum membandingkan temuan.',
    baselineTruncated: 'Baseline terpotong, sehingga temuan baru tidak dapat ditentukan dengan aman.',
    currentTruncated: 'Audit saat ini terpotong, sehingga temuan yang sudah teratasi tidak dapat ditentukan dengan aman.'
  },
  indexedDb: {
    origin: 'Hanya origin tingkat atas ini yang dicakup; database di frame pihak ketiga tidak disertakan.',
    snapshot: 'Database dan data merupakan snapshot pada satu waktu. Muat ulang setelah situs mengubah IndexedDB.',
    names: 'Nama database, penyimpanan objek, indeks, dan kunci ditulis oleh situs dan dapat berisi data pribadi.',
    longNames: 'Database dan penyimpanan objek dengan nama lebih dari 512 karakter dihilangkan.',
    valuesIncluded: 'Pratinjau data dibatasi dan dapat berisi data aplikasi pribadi.',
    valuesOmitted: 'Nilai data dihilangkan.',
    readOnly: 'Inspektor ini hanya membaca IndexedDB dan tidak pernah mengubah atau menghapusnya.'
  },
  storageUsage: {
    estimates: 'Penggunaan dan kuota adalah perkiraan browser pada satu waktu dan dapat berubah saat Chromium mengosongkan atau menulis data.',
    quota: 'Kuota adalah anggaran yang saat ini dilaporkan Chromium untuk origin ini, bukan ruang kosong di perangkat.',
    origin: 'Hanya origin HTTP(S) tingkat atas ini yang dicakup; penyimpanan pihak ketiga dan yang dipartisi dapat dihitung terpisah.',
    aggregates: 'Hanya jumlah total byte dan kategori penyimpanan browser yang ditampilkan. Kunci, nilai, nama file, dan body respons tidak pernah disertakan.',
    readOnly: 'Inspektor ini hanya membaca penggunaan penyimpanan dan tidak pernah mengubah atau menghapus data.',
    fallback: 'Rincian kuota mendetail dari Chromium tidak tersedia, jadi laporan ini menggunakan perkiraan keseluruhan browser: {reason}'
  },
  storageChanges: {
    baseline: 'Baseline hanya disimpan di memori dan dibuang saat Anda menghapusnya, saat tab berpindah origin atau ditutup, atau saat Hronaut keluar.',
    scope: 'Penyimpanan lokal dan cookie dibagikan per origin dalam ruang kerja ini dan diisolasi dari ruang kerja lain; penyimpanan sesi hanya milik tab ini.',
    valuesIncluded: 'Nilai ditampilkan hingga batas ukuran tertentu. Nilai cookie HttpOnly selalu tetap terlindungi.',
    valuesOmitted: 'Nilai dihilangkan.',
    snapshot: 'Snapshot mencakup 200 entri pertama yang diurutkan dari setiap jenis penyimpanan. Penyimpanan juga dapat berubah di latar belakang antara baseline dan perbandingan.'
  },
  pwa: {
    origin: 'Hanya origin tingkat atas ini yang dicakup; worker dan cache di frame pihak ketiga tidak disertakan.',
    snapshot: 'Pendaftaran dan entri cache merupakan snapshot pada satu waktu. Muat ulang setelah situs mengubah status offline-nya.',
    manifest: 'Manifes dibaca ke dalam beberapa kolom terbatas; sumber mentahnya tidak pernah ditampilkan.',
    installabilityIds: 'ID error kemampuan instal berasal dari Chromium dan dapat berubah antarversi Chromium.',
    readOnly: 'Inspektor ini hanya membaca data offline dan tidak pernah menampilkan body respons yang di-cache.',
    headersIncluded: 'Header permintaan dan respons ditampilkan hingga batas tertentu; header yang dikenali membawa rahasia akan disamarkan.',
    headersOmitted: 'Nilai header dihilangkan.',
    opaqueSizes: 'Ukuran respons opaque dapat mencakup padding kuota browser dan tidak diukur di sini.',
    clearing: 'Inspektor ini tidak pernah membatalkan pendaftaran worker atau menghapus cache.',
    installabilityUnavailable: 'Diagnostik kemampuan instal tidak tersedia: {reason}'
  }
}

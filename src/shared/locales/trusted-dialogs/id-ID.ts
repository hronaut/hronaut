export const idIDTrustedDialogs = {
  close: 'Tutup',
  httpAuth: {
    eyebrow: 'Masuk',
    headline: 'Masuk ke {origin}',
    notPrivate: 'Koneksi Anda ke situs ini tidak pribadi. Siapa pun di jaringan dapat membaca nama pengguna dan sandi Anda.',
    workspace: 'Anda tetap masuk ke situs ini di ruang kerja “{workspace}” sampai Hronaut ditutup.',
    sent: 'Hronaut mengirim nama pengguna dan sandi Anda hanya ke situs ini dan tidak pernah menampilkannya kepada agen.',
    username: 'Nama pengguna',
    password: 'Sandi',
    signIn: 'Masuk'
  },
  certificate: {
    eyebrow: 'Tidak pribadi',
    headline: 'Lanjutkan ke {host}?',
    authority: 'Sertifikat keamanannya bukan dari otoritas yang dipercaya komputer ini.',
    name: 'Sertifikat keamanannya milik situs lain.',
    date: 'Sertifikat keamanannya sudah kedaluwarsa atau belum berlaku.',
    other: 'Sertifikat keamanannya tidak dapat diverifikasi.',
    risk: 'Seseorang di jaringan mungkin menyamar sebagai situs ini untuk membaca apa yang Anda kirim ke situs ini, seperti sandi.',
    workspace: 'Hronaut memercayai sertifikat ini untuk situs ini di ruang kerja “{workspace}” sampai Hronaut ditutup, dan agen di ruang kerja juga dapat membukanya.',
    session: 'Hronaut memercayai sertifikat ini untuk situs ini sampai Hronaut ditutup.',
    back: 'Kembali ke tempat aman',
    proceed: 'Lanjutkan (tidak aman)'
  },
  savePassword: {
    eyebrow: 'Sandi tersimpan',
    save: 'Simpan sandi Anda untuk {origin}?',
    update: 'Perbarui sandi tersimpan Anda untuk {origin}?',
    username: 'Nama pengguna',
    noUsername: 'Halaman tidak mengirimkan nama pengguna bersama sandi ini.',
    stored: 'Hronaut mengenkripsinya dengan penyimpanan aman sistem operasi Anda. Sandi tersimpan tidak pernah diekspos melalui MCP.'
  },
  walletRecovery: {
    eyebrow: 'Dompet baru',
    headline: 'Catat frasa pemulihan untuk {wallet}',
    phrase: 'Frasa pemulihan',
    keep: 'Catat kata-kata ini secara berurutan dan simpan secara offline. Siapa pun yang memilikinya dapat mengontrol dompet ini.',
    added: 'Hronaut menambahkan dompet setelah Anda mengonfirmasi bahwa kata-kata tersebut sudah disimpan.'
  },
  claudeSetup: {
    file: 'File',
    added: 'Entri baru di "mcpServers"',
    replaces: 'Entri yang digantikan'
  },
  sitePermission: {
    embeddedIn: 'Disematkan di {site}',
    wants: {
      camera: '{origin} ingin menggunakan kamera Anda',
      microphone: '{origin} ingin menggunakan mikrofon Anda',
      cameraAndMicrophone: '{origin} ingin menggunakan kamera dan mikrofon Anda',
      geolocation: '{origin} ingin mengetahui lokasi Anda',
      notifications: '{origin} ingin menampilkan notifikasi',
      clipboardRead: '{origin} ingin melihat teks dan gambar yang Anda salin',
      clipboardWrite: '{origin} ingin menyalin teks dan gambar ke papan klip Anda',
      midiSysex: '{origin} ingin mengontrol dan memprogram ulang perangkat MIDI Anda',
      midi: '{origin} ingin menggunakan perangkat MIDI Anda',
      localFonts: '{origin} ingin menggunakan font di komputer Anda',
      localNetwork: '{origin} ingin menemukan dan terhubung ke perangkat di jaringan lokal Anda',
      loopbackNetwork: '{origin} ingin terhubung ke aplikasi dan layanan di perangkat ini',
      fileSystem: '{origin} ingin menggunakan file atau folder di komputer Anda',
      openExternal: '{origin} ingin membuka aplikasi di komputer Anda',
      fullscreen: '{origin} ingin menggunakan layar penuh',
      idleDetection: '{origin} ingin mengetahui kapan Anda menggunakan perangkat ini',
      keyboardLock: '{origin} ingin mengambil alih pintasan keyboard Anda',
      pointerLock: '{origin} ingin mengunci dan menyembunyikan kursor mouse Anda',
      persistentStorage: '{origin} ingin menyimpan data secara permanen di perangkat ini',
      screenWakeLock: '{origin} ingin membuat layar Anda tetap menyala',
      storageAccess: '{origin} ingin menggunakan cookie dan data situsnya di halaman ini',
      topLevelStorageAccess: '{origin} ingin menggunakan cookie dan data situs dari situs terkait',
      windowManagement: '{origin} ingin mengelola jendela di semua layar Anda',
      displayCapture: '{origin} ingin melihat layar Anda',
      other: '{origin} ingin menggunakan “{permission}”'
    }
  }
}

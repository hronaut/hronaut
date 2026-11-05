export const idIDHomeReadiness = {
  heading: 'Kesiapan MCP',
  description: 'Verifikasi setiap batas secara terpisah sebelum mengandalkan alat browser.',
  checks: {
    app: 'Aplikasi',
    endpoint: 'Endpoint lokal',
    initialization: 'Inisialisasi klien',
    advertisedTools: 'Alat yang diiklankan',
    configuration: 'Konfigurasi klien',
    clientVisibility: 'Alat terlihat di klien aktif',
    probe: 'Probe hanya baca'
  },
  inventory: 'Tempel daftar alat yang ditampilkan oleh klien aktif',
  inventoryPlaceholder: 'Tempel output klien yang berisi nama alat browser_* atau wallet_*',
  verifyInventory: 'Bandingkan daftar alat',
  copyReport: 'Salin diagnostik',
  reportLabel: 'Diagnostik kesiapan MCP yang aman untuk disalin',
  privacy: 'Perbandingan tetap berada di halaman ini. Laporan yang disalin hanya berisi status bertipe, jumlah, nama alat yang dibatasi, dan stempel waktu.',
  nextAction: {
    start_honaut: 'Mulai atau perbaiki listener Hronaut lokal.',
    connect_client: 'Hubungkan ulang klien MCP aktif dan tunggu inisialisasi selesai.',
    verify_client_configuration: 'Konfirmasi endpoint dan autentikasi ini di konfigurasi klien aktif.',
    list_tools_in_active_client: 'Tampilkan daftar alat di klien aktif dan bandingkan di sini.',
    run_read_only_probe: 'Di ruang kerja milik tugas, panggil browser_status atau browser_snapshot sekali.',
    retry_read_only_probe: 'Periksa error klien aktif, lalu coba lagi satu probe hanya baca.',
    none: 'Tidak ada tindakan yang diperlukan untuk pemeriksaan ini.'
  }
}

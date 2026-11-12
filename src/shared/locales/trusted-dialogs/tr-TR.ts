export const trTRTrustedDialogs = {
  close: 'Kapat',
  httpAuth: {
    eyebrow: 'Oturum aç',
    headline: '{origin} sitesinde oturum açın',
    notPrivate: 'Bu siteye bağlantınız gizli değil. Ağdaki herkes kullanıcı adınızı ve şifrenizi okuyabilir.',
    workspace: 'Hronaut kapanana kadar “{workspace}” çalışma alanında bu web sitesinde oturumunuz açık kalır.',
    sent: 'Hronaut kullanıcı adınızı ve şifrenizi yalnızca bu web sitesine gönderir ve bunları ajanlara asla göstermez.',
    username: 'Kullanıcı adı',
    password: 'Şifre',
    signIn: 'Oturum aç'
  },
  certificate: {
    eyebrow: 'Gizli değil',
    headline: '{host} sitesine ilerlensin mi?',
    authority: 'Güvenlik sertifikası, bu bilgisayarın güvendiği bir yetkiliden alınmamış.',
    name: 'Güvenlik sertifikası başka bir web sitesine ait.',
    date: 'Güvenlik sertifikasının süresi dolmuş veya henüz geçerli değil.',
    other: 'Güvenlik sertifikası doğrulanamıyor.',
    risk: 'Ağdaki biri, bu web sitesine gönderdiklerinizi, örneğin şifreleri okumak için bu web sitesiymiş gibi davranıyor olabilir.',
    workspace: 'Hronaut kapanana kadar “{workspace}” çalışma alanında bu web sitesi için bu sertifikaya güvenir ve çalışma alanındaki ajanlar da siteyi açabilir.',
    session: 'Hronaut kapanana kadar bu web sitesi için bu sertifikaya güvenir.',
    back: 'Güvenli sayfaya dön',
    proceed: 'İlerle (güvenli değil)'
  },
  savePassword: {
    eyebrow: 'Kayıtlı şifreler',
    save: '{origin} için şifreniz kaydedilsin mi?',
    update: '{origin} için kayıtlı şifreniz güncellensin mi?',
    username: 'Kullanıcı adı',
    noUsername: 'Sayfa, şifreyle birlikte bir kullanıcı adı göndermedi.',
    stored: 'Hronaut şifreyi işletim sisteminizin güvenli depolama alanıyla şifreler. Kayıtlı şifreler MCP üzerinden hiçbir zaman paylaşılmaz.'
  },
  walletRecovery: {
    eyebrow: 'Yeni cüzdan',
    headline: '{wallet} için kurtarma ifadesini not edin',
    phrase: 'Kurtarma ifadesi',
    keep: 'Bu kelimeleri sırasıyla not edin ve çevrimdışı saklayın. Bu kelimelere sahip olan herkes cüzdanı kontrol eder.',
    added: 'Hronaut, kelimeleri kaydettiğinizi onayladığınızda cüzdanı ekler.'
  },
  claudeSetup: {
    file: 'Dosya',
    added: '"mcpServers" içindeki yeni giriş',
    replaces: 'Yerini aldığı giriş'
  },
  sitePermission: {
    embeddedIn: '{site} içine yerleştirilmiş',
    wants: {
      camera: '{origin} kameranızı kullanmak istiyor',
      microphone: '{origin} mikrofonunuzu kullanmak istiyor',
      cameraAndMicrophone: '{origin} kameranızı ve mikrofonunuzu kullanmak istiyor',
      geolocation: '{origin} konumunuzu öğrenmek istiyor',
      notifications: '{origin} bildirim göstermek istiyor',
      clipboardRead: '{origin} kopyaladığınız metin ve resimleri görmek istiyor',
      midiSysex: '{origin} MIDI cihazlarınızı kontrol etmek ve yeniden programlamak istiyor',
      midi: '{origin} MIDI cihazlarınızı kullanmak istiyor',
      localFonts: '{origin} bilgisayarınızdaki yazı tiplerini kullanmak istiyor',
      localNetwork: '{origin} yerel ağınızdaki cihazları bulmak ve onlara bağlanmak istiyor',
      loopbackNetwork: '{origin} bu cihazdaki uygulama ve hizmetlere bağlanmak istiyor',
      fileSystem: '{origin} bilgisayarınızdaki bir dosyayı veya klasörü kullanmak istiyor',
      openExternal: '{origin} bilgisayarınızda bir uygulama açmak istiyor',
      idleDetection: '{origin} bu cihazı ne zaman kullandığınızı bilmek istiyor',
      keyboardLock: '{origin} klavye kısayollarınızı yakalamak istiyor',
      pointerLock: '{origin} fare işaretçinizi kilitlemek ve gizlemek istiyor',
      windowManagement: '{origin} tüm ekranlarınızdaki pencereleri yönetmek istiyor',
      displayCapture: '{origin} ekranınızı görmek istiyor',
      other: '{origin} “{permission}” iznini kullanmak istiyor'
    }
  }
}

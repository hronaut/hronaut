export const zhTWTrustedDialogs = {
  close: '關閉',
  httpAuth: {
    eyebrow: '登入',
    headline: '登入 {origin}',
    notPrivate: '你與這個網站之間的連線不是私人連線。網路上的任何人都能讀取你的使用者名稱和密碼。',
    workspace: '在 Hronaut 結束前，你會在「{workspace}」工作區中保持這個網站的登入狀態。',
    sent: 'Hronaut 只會將你的使用者名稱和密碼傳送給這個網站，絕不會向代理程式顯示。',
    username: '使用者名稱',
    password: '密碼',
    signIn: '登入'
  },
  certificate: {
    eyebrow: '非私人連線',
    headline: '要繼續前往 {host} 嗎？',
    authority: '其安全性憑證並非來自這部電腦信任的憑證授權單位。',
    name: '其安全性憑證屬於另一個網站。',
    date: '其安全性憑證已過期或尚未生效。',
    other: '無法驗證其安全性憑證。',
    risk: '網路上可能有人假冒這個網站，以讀取你傳送給它的內容，例如密碼。',
    workspace: '在 Hronaut 結束前，Hronaut 會在「{workspace}」工作區中為這個網站信任這個憑證，工作區中的代理程式也能開啟它。',
    session: '在 Hronaut 結束前，Hronaut 會為這個網站信任這個憑證。',
    back: '返回安全性頁面',
    proceed: '繼續前往（不安全）'
  },
  savePassword: {
    eyebrow: '已儲存的密碼',
    save: '要儲存 {origin} 的密碼嗎？',
    update: '要更新 {origin} 的已儲存密碼嗎？',
    username: '使用者名稱',
    noUsername: '網頁未一併傳送使用者名稱。',
    stored: 'Hronaut 會使用作業系統的安全儲存空間加密密碼。已儲存的密碼絕不會透過 MCP 外洩。'
  },
  walletRecovery: {
    eyebrow: '新錢包',
    headline: '請抄下 {wallet} 的復原詞組',
    phrase: '復原詞組',
    keep: '請依序抄下這些字詞，並離線保存。任何取得這些字詞的人都能控制這個錢包。',
    added: '在你確認已保存後，Hronaut 就會新增這個錢包。'
  },
  claudeSetup: {
    file: '檔案',
    added: '"mcpServers" 中的新項目',
    replaces: '將被取代的項目'
  },
  sitePermission: {
    embeddedIn: '嵌入於 {site}',
    wants: {
      camera: '{origin} 想要使用你的攝影機',
      microphone: '{origin} 想要使用你的麥克風',
      cameraAndMicrophone: '{origin} 想要使用你的攝影機和麥克風',
      geolocation: '{origin} 想要知道你的位置',
      notifications: '{origin} 想要顯示通知',
      clipboardRead: '{origin} 想要查看你複製的文字和圖片',
      clipboardWrite: '{origin} 想要將文字和圖片複製到你的剪貼簿',
      midiSysex: '{origin} 想要控制你的 MIDI 裝置並重新設定程式',
      midi: '{origin} 想要使用你的 MIDI 裝置',
      localFonts: '{origin} 想要使用你電腦上的字型',
      localNetwork: '{origin} 想要尋找並連線到你區域網路中的裝置',
      loopbackNetwork: '{origin} 想要連線到這部裝置上的應用程式和服務',
      fileSystem: '{origin} 想要使用你電腦上的檔案或資料夾',
      openExternal: '{origin} 想要開啟你電腦上的應用程式',
      fullscreen: '{origin} 想要使用全螢幕',
      idleDetection: '{origin} 想要知道你何時在使用這部裝置',
      keyboardLock: '{origin} 想要擷取你的鍵盤快速鍵',
      pointerLock: '{origin} 想要鎖定並隱藏你的滑鼠游標',
      persistentStorage: '{origin} 想要在這部裝置上永久儲存資料',
      screenWakeLock: '{origin} 想要讓你的螢幕保持開啟',
      storageAccess: '{origin} 想要在這個頁面上使用自己的 Cookie 和網站資料',
      topLevelStorageAccess: '{origin} 想要使用相關網站的 Cookie 和網站資料',
      windowManagement: '{origin} 想要管理你所有螢幕上的視窗',
      displayCapture: '{origin} 想要查看你的螢幕',
      other: '{origin} 想要使用「{permission}」'
    }
  }
}

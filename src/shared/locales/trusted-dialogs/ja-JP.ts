export const jaJPTrustedDialogs = {
  close: '閉じる',
  httpAuth: {
    eyebrow: 'サインイン',
    headline: '{origin} にサインイン',
    notPrivate: 'このサイトへの接続は保護されていません。ネットワーク上の誰でも、ユーザー名とパスワードを読み取れます。',
    workspace: 'Hronaut を終了するまで、「{workspace}」ワークスペースでこのウェブサイトにサインインしたままになります。',
    sent: 'Hronaut はユーザー名とパスワードをこのウェブサイトにだけ送信し、エージェントに表示することはありません。',
    username: 'ユーザー名',
    password: 'パスワード',
    signIn: 'サインイン'
  },
  certificate: {
    eyebrow: '保護されていない接続',
    headline: '{host} にアクセスしますか？',
    authority: 'このサイトのセキュリティ証明書は、このコンピュータが信頼する認証局から発行されていません。',
    name: 'このサイトのセキュリティ証明書は別のウェブサイトのものです。',
    date: 'このサイトのセキュリティ証明書は期限切れか、まだ有効になっていません。',
    other: 'このサイトのセキュリティ証明書を検証できません。',
    risk: 'ネットワーク上の誰かがこのウェブサイトになりすまし、パスワードなど送信する内容を読み取ろうとしている可能性があります。',
    workspace: 'Hronaut を終了するまで、「{workspace}」ワークスペースではこのウェブサイトのこの証明書を信頼し、ワークスペースのエージェントもこのサイトを開けるようになります。',
    session: 'Hronaut を終了するまで、このウェブサイトのこの証明書を信頼します。',
    back: '安全なページに戻る',
    proceed: 'アクセスする（安全ではありません）'
  },
  savePassword: {
    eyebrow: '保存したパスワード',
    save: '{origin} のパスワードを保存しますか？',
    update: '{origin} の保存済みパスワードを更新しますか？',
    username: 'ユーザー名',
    noUsername: 'このページからユーザー名は送信されませんでした。',
    stored: 'Hronaut はオペレーティング システムの安全なストレージを使ってパスワードを暗号化します。保存したパスワードが MCP を通じて公開されることはありません。'
  },
  walletRecovery: {
    eyebrow: '新しいウォレット',
    headline: '{wallet} の復元フレーズを書き留めてください',
    phrase: '復元フレーズ',
    keep: 'これらの単語を順番どおりに書き留めて、オフラインで保管してください。これを知っている人は誰でもウォレットを操作できます。',
    added: '保存したことを確認すると、Hronaut がウォレットを追加します。'
  },
  claudeSetup: {
    file: 'ファイル',
    added: '"mcpServers" の新しいエントリ',
    replaces: '置き換えられるエントリ'
  },
  sitePermission: {
    embeddedIn: '{site} に埋め込まれています',
    wants: {
      camera: '{origin} がカメラの使用を求めています',
      microphone: '{origin} がマイクの使用を求めています',
      cameraAndMicrophone: '{origin} がカメラとマイクの使用を求めています',
      geolocation: '{origin} が現在地の情報へのアクセスを求めています',
      notifications: '{origin} が通知の表示を求めています',
      clipboardRead: '{origin} が、コピーしたテキストや画像の確認を求めています',
      midiSysex: '{origin} が MIDI デバイスの制御と再プログラムを求めています',
      midi: '{origin} が MIDI デバイスの使用を求めています',
      localFonts: '{origin} が、パソコンのフォントの使用を求めています',
      localNetwork: '{origin} が、ローカル ネットワーク上のデバイスの検出と接続を求めています',
      loopbackNetwork: '{origin} が、このデバイス上のアプリやサービスへの接続を求めています',
      fileSystem: '{origin} が、パソコン上のファイルまたはフォルダの使用を求めています',
      openExternal: '{origin} が、パソコン上のアプリを開こうとしています',
      idleDetection: '{origin} が、このデバイスを使用中かどうかの把握を求めています',
      keyboardLock: '{origin} が、キーボード ショートカットの取得を求めています',
      pointerLock: '{origin} が、マウス ポインタのロックと非表示を求めています',
      windowManagement: '{origin} が、すべてのディスプレイ上のウィンドウの管理を求めています',
      displayCapture: '{origin} が画面の共有を求めています',
      other: '{origin} が「{permission}」の使用を求めています'
    }
  }
}

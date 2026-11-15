export const zhCNTrustedDialogs = {
  close: '关闭',
  httpAuth: {
    eyebrow: '登录',
    headline: '登录到 {origin}',
    notPrivate: '您与此网站之间的连接不是私密连接。网络上的任何人都能读取您的用户名和密码。',
    workspace: '在 Hronaut 退出前，您会在“{workspace}”工作区中保持此网站的登录状态。',
    sent: 'Hronaut 只会将您的用户名和密码发送给此网站，绝不会向智能体显示。',
    username: '用户名',
    password: '密码',
    signIn: '登录'
  },
  certificate: {
    eyebrow: '连接不私密',
    headline: '要继续前往 {host} 吗？',
    authority: '其安全证书并非来自此计算机信任的颁发机构。',
    name: '其安全证书属于另一个网站。',
    date: '其安全证书已过期或尚未生效。',
    other: '无法验证其安全证书。',
    risk: '网络上可能有人在冒充此网站，以读取您发送给它的内容，例如密码。',
    workspace: '在 Hronaut 退出前，Hronaut 会在“{workspace}”工作区中为此网站信任此证书，该工作区中的智能体也可以打开它。',
    session: '在 Hronaut 退出前，Hronaut 会为此网站信任此证书。',
    back: '返回安全连接',
    proceed: '继续前往（不安全）'
  },
  savePassword: {
    eyebrow: '已保存的密码',
    save: '要保存您在 {origin} 上的密码吗？',
    update: '要更新您在 {origin} 上已保存的密码吗？',
    username: '用户名',
    noUsername: '页面未随密码一起发送用户名。',
    stored: 'Hronaut 会使用操作系统的安全存储对其进行加密。已保存的密码绝不会通过 MCP 公开。'
  },
  walletRecovery: {
    eyebrow: '新钱包',
    headline: '请写下 {wallet} 的恢复短语',
    phrase: '恢复短语',
    keep: '请按顺序写下这些单词，并离线保存。任何拥有这些单词的人都能控制此钱包。',
    added: '在您确认已保存后，Hronaut 才会添加此钱包。'
  },
  claudeSetup: {
    file: '文件',
    added: '"mcpServers" 中的新条目',
    replaces: '它将替换的条目'
  },
  sitePermission: {
    embeddedIn: '嵌入在 {site} 中',
    wants: {
      camera: '{origin} 想要使用您的摄像头',
      microphone: '{origin} 想要使用您的麦克风',
      cameraAndMicrophone: '{origin} 想要使用您的摄像头和麦克风',
      geolocation: '{origin} 想要知道您的位置',
      notifications: '{origin} 想要显示通知',
      clipboardRead: '{origin} 想要查看您复制的文字和图片',
      midiSysex: '{origin} 想要控制您的 MIDI 设备并对其重新编程',
      midi: '{origin} 想要使用您的 MIDI 设备',
      localFonts: '{origin} 想要使用您计算机上的字体',
      localNetwork: '{origin} 想要查找并连接到您局域网中的设备',
      loopbackNetwork: '{origin} 想要连接到此设备上的应用和服务',
      fileSystem: '{origin} 想要使用您计算机上的文件或文件夹',
      openExternal: '{origin} 想要打开您计算机上的应用',
      idleDetection: '{origin} 想要知道您何时在使用此设备',
      keyboardLock: '{origin} 想要捕获您的键盘快捷键',
      pointerLock: '{origin} 想要锁定并隐藏您的鼠标指针',
      windowManagement: '{origin} 想要管理您所有显示器上的窗口',
      displayCapture: '{origin} 想要查看您的屏幕',
      other: '{origin} 想要使用“{permission}”'
    }
  }
}

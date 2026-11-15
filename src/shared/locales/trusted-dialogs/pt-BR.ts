export const ptBRTrustedDialogs = {
  close: 'Fechar',
  httpAuth: {
    eyebrow: 'Fazer login',
    headline: 'Fazer login em {origin}',
    notPrivate: 'Sua conexão com este site não é particular. Qualquer pessoa na rede pode ler seu nome de usuário e sua senha.',
    workspace: 'Você continua conectado a este site no espaço de trabalho “{workspace}” até o Hronaut ser fechado.',
    sent: 'O Hronaut envia seu nome de usuário e sua senha somente para este site e nunca os mostra aos agentes.',
    username: 'Nome de usuário',
    password: 'Senha',
    signIn: 'Fazer login'
  },
  certificate: {
    eyebrow: 'Conexão não particular',
    headline: 'Ir para {host}?',
    authority: 'O certificado de segurança dele não é de uma autoridade em que este computador confia.',
    name: 'O certificado de segurança dele é de outro site.',
    date: 'O certificado de segurança dele expirou ou ainda não é válido.',
    other: 'Não é possível verificar o certificado de segurança dele.',
    risk: 'Alguém na rede pode estar se passando por este site para ler o que você envia a ele, como senhas.',
    workspace: 'O Hronaut confia neste certificado para este site no espaço de trabalho “{workspace}” até o Hronaut ser fechado, e os agentes do espaço de trabalho também podem abri-lo.',
    session: 'O Hronaut confia neste certificado para este site até o Hronaut ser fechado.',
    back: 'Voltar à segurança',
    proceed: 'Ir (não seguro)'
  },
  savePassword: {
    eyebrow: 'Senhas salvas',
    save: 'Salvar sua senha de {origin}?',
    update: 'Atualizar sua senha salva de {origin}?',
    username: 'Nome de usuário',
    noUsername: 'A página não enviou um nome de usuário junto.',
    stored: 'O Hronaut a criptografa com o armazenamento seguro do sistema operacional. As senhas salvas nunca são expostas pelo MCP.'
  },
  walletRecovery: {
    eyebrow: 'Nova carteira',
    headline: 'Anote a frase de recuperação de {wallet}',
    phrase: 'Frase de recuperação',
    keep: 'Anote estas palavras na ordem e guarde-as off-line. Qualquer pessoa que as tiver controla a carteira.',
    added: 'O Hronaut adiciona a carteira assim que você confirmar que as salvou.'
  },
  claudeSetup: {
    file: 'Arquivo',
    added: 'Nova entrada em "mcpServers"',
    replaces: 'Entrada que ela substitui'
  },
  sitePermission: {
    embeddedIn: 'Incorporado em {site}',
    wants: {
      camera: '{origin} quer usar sua câmera',
      microphone: '{origin} quer usar seu microfone',
      cameraAndMicrophone: '{origin} quer usar sua câmera e seu microfone',
      geolocation: '{origin} quer saber sua localização',
      notifications: '{origin} quer mostrar notificações',
      clipboardRead: '{origin} quer ver textos e imagens que você copia',
      midiSysex: '{origin} quer controlar e reprogramar seus dispositivos MIDI',
      midi: '{origin} quer usar seus dispositivos MIDI',
      localFonts: '{origin} quer usar as fontes do seu computador',
      localNetwork: '{origin} quer encontrar dispositivos na sua rede local e se conectar a eles',
      loopbackNetwork: '{origin} quer se conectar a apps e serviços neste dispositivo',
      fileSystem: '{origin} quer usar um arquivo ou uma pasta do seu computador',
      openExternal: '{origin} quer abrir um app no seu computador',
      idleDetection: '{origin} quer saber quando você está usando este dispositivo',
      keyboardLock: '{origin} quer capturar seus atalhos de teclado',
      pointerLock: '{origin} quer bloquear e ocultar o ponteiro do mouse',
      windowManagement: '{origin} quer gerenciar janelas em todas as suas telas',
      displayCapture: '{origin} quer ver sua tela',
      other: '{origin} quer usar “{permission}”'
    }
  }
}

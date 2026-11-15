export const ptBRRemoteConnections = {
  label: 'Permitir conexões de outros computadores',
  description: 'Escuta em todas as interfaces de rede IPv4. A autenticação por token é opcional. Sem ela, qualquer pessoa que consiga alcançar este listener pode controlar seu navegador e anexar arquivos locais.',
  restart: 'Reinicie o Hronaut depois de alterar o acesso remoto. As mudanças de autenticação se aplicam imediatamente.',
  connection: 'No outro computador, use http://IP-na-LAN-deste-computador:{port}/mcp e, se a autenticação estiver ativada, uma credencial de portador dos Perfis de capacidades abaixo. Permita esta porta no seu firewall. Use somente uma rede confiável: o HTTP não criptografa o tráfego.'
}

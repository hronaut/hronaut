export const zhCNRemoteConnections = {
  label: '允许来自其他计算机的连接',
  description: '在所有 IPv4 网络接口上监听。令牌身份验证是可选的。如果不启用，任何能访问此监听器的人都可以控制您的浏览器并附加本地文件。',
  restart: '更改远程访问设置后，请重启 Hronaut。身份验证更改会立即生效。',
  connection: '在另一台计算机上，请使用 http://本机局域网IP:{port}/mcp；如果已启用身份验证，还需使用下方“能力配置”中的持有者凭据。请在防火墙中允许此端口。请仅在受信任的网络中使用：HTTP 不会加密流量。'
}

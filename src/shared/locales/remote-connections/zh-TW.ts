export const zhTWRemoteConnections = {
  label: '允許其他電腦連線',
  description: '在所有 IPv4 網路介面上監聽。權杖驗證為選用功能；若未啟用，任何能連上此監聽程式的人都能控制你的瀏覽器並附加本機檔案。',
  restart: '變更遠端存取設定後，請重新啟動 Hronaut。驗證設定的變更會立即生效。',
  connection: '在另一部電腦上使用 http://this-computer-LAN-IP:{port}/mcp；若已啟用驗證，請另外使用下方「能力設定檔」中的 Bearer 憑證。請在防火牆中允許這個連接埠，且僅在可信任的網路中使用：HTTP 不會加密流量。'
}

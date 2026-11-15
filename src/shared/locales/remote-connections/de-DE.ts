export const deDERemoteConnections = {
  label: 'Verbindungen von anderen Computern erlauben',
  description: 'Auf allen IPv4-Netzwerkschnittstellen lauschen. Token-Authentifizierung ist optional. Ohne sie kann jeder, der diesen Listener erreicht, Ihren Browser steuern und lokale Dateien anhängen.',
  restart: 'Starten Sie Hronaut nach einer Änderung des Fernzugriffs neu. Änderungen an der Authentifizierung gelten sofort.',
  connection: 'Verwenden Sie auf dem anderen Computer http://this-computer-LAN-IP:{port}/mcp und, falls die Authentifizierung aktiviert ist, Bearer-Zugangsdaten aus den Berechtigungsprofilen unten. Erlauben Sie diesen Port in Ihrer Firewall. Verwenden Sie nur ein vertrauenswürdiges Netzwerk: HTTP verschlüsselt den Datenverkehr nicht.'
}

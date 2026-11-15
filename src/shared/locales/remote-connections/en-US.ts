export const enUSRemoteConnections = {
  label: 'Allow connections from other computers',
  description: 'Listen on all IPv4 network interfaces. Token authentication is optional. Without it, anyone who can reach this listener can control your browser and attach local files.',
  restart: 'Restart Hronaut after changing remote access. Authentication changes apply immediately.',
  connection: 'On the other computer, use http://this-computer-LAN-IP:{port}/mcp and, if authentication is enabled, a bearer credential from Capability profiles below. Allow this port in your firewall. Use only a trusted network: HTTP does not encrypt traffic.'
}

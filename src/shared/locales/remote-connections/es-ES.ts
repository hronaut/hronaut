export const esESRemoteConnections = {
  label: 'Permitir conexiones desde otros equipos',
  description: 'Escuchar en todas las interfaces de red IPv4. La autenticación por token es opcional. Sin ella, cualquiera que pueda llegar a este servidor puede controlar tu navegador y adjuntar archivos locales.',
  restart: 'Reinicia Hronaut después de cambiar el acceso remoto. Los cambios de autenticación se aplican de inmediato.',
  connection: 'En el otro equipo, usa http://this-computer-LAN-IP:{port}/mcp y, si la autenticación está activada, una credencial bearer de Perfiles de capacidades, más abajo. Permite este puerto en tu cortafuegos. Usa solo una red de confianza: HTTP no cifra el tráfico.'
}

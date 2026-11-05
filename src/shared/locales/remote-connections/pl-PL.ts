export const plPLRemoteConnections = {
  label: 'Zezwalaj na połączenia z innych komputerów',
  description: 'Nasłuchuj na wszystkich interfejsach sieciowych IPv4. Uwierzytelnianie tokenem jest opcjonalne. Bez niego każdy, kto może połączyć się z tym serwerem nasłuchującym, może sterować Twoją przeglądarką i dołączać lokalne pliki.',
  restart: 'Po zmianie dostępu zdalnego uruchom ponownie Hronaut. Zmiany uwierzytelniania obowiązują natychmiast.',
  connection: 'Na drugim komputerze użyj adresu http://this-computer-LAN-IP:{port}/mcp oraz, jeśli uwierzytelnianie jest włączone, poświadczenia bearer z sekcji Profile uprawnień poniżej. Zezwól na ten port w zaporze sieciowej. Korzystaj tylko z zaufanej sieci: HTTP nie szyfruje ruchu.'
}

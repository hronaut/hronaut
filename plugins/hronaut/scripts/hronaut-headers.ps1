# Run by hronaut-headers.cmd on Windows. It prints what hronaut-headers.sh prints: the Authorization header from the
# owner-only token file in Hronaut's profile, as JSON on one line, or `{}` when there is no Hronaut token to send.
$ErrorActionPreference = 'Stop'

# Claude Code names the address the header goes to, which the plugin's MCP address option sets. The token goes only to
# a numbered port on this computer: anything after the port but a path could send it to another host.
$address = $env:CLAUDE_CODE_MCP_SERVER_URL
$profileDirectory = $env:HRONAUT_USER_DATA_DIR
# Electron puts Hronaut's profile in the roaming application data folder, named after the app's lowercase package name.
if (-not $profileDirectory) { $profileDirectory = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'hronaut' }

$token = ''
try {
  # Hronaut trims the file; reading it as text drops a byte order mark.
  $token = [System.IO.File]::ReadAllText((Join-Path $profileDirectory 'mcp-token')).Trim()
} catch {
  $token = ''
}

# Hronaut writes 32 or more URL-safe characters; anything else is not its token and is never sent.
if ($address -cmatch '^http://(127\.0\.0\.1|localhost|\[::1\]):[0-9]+(/|\z)' -and $token -cmatch '^[A-Za-z0-9_-]{32,}\z') {
  [Console]::Out.Write('{"Authorization":"Bearer ' + $token + '"}' + "`n")
} else {
  [Console]::Out.Write("{}`n")
}

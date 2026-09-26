import type { AgentGuideId } from './agent-guides.js'
import { localeMessages } from './i18n.js'
import type { SupportedLocale } from './locale.js'

export interface AgentGuide {
  id: AgentGuideId
  name: string
  note: string
  location: string
  code: string
  setupCommand?: string
  verifyCommand?: string
  action?: 'open-vscode-install'
}
export interface ClientConfigurationOptions {
  endpoint: string
  locale: SupportedLocale
  tokenPath?: string
  authenticationDisabled?: boolean
  platform?: string
}

/** Pure public templates. Only the desktop substitutes its actual endpoint and token file. */
export function clientConfigurations(options: ClientConfigurationOptions): AgentGuide[] {
  const { endpoint, locale, tokenPath, authenticationDisabled = false } = options
  const home = localeMessages[locale].home
  const notes = home.connect.guides
  const windows = options.platform === 'win32'
  const quote = (value: string): string => `'${value.replaceAll("'", windows ? "''" : "'\\''")}'`
  const tokenSetup = tokenPath ? windows
    ? `$env:HRONAUT_MCP_TOKEN = (Get-Content -Raw ${quote(tokenPath)}).Trim()\n`
    : `export HRONAUT_MCP_TOKEN="$(cat ${quote(tokenPath)})"\n` : ''
  const tokenReference = windows ? '$env:HRONAUT_MCP_TOKEN' : '$HRONAUT_MCP_TOKEN'
  const placeholder = tokenPath ? `<paste token from ${tokenPath}>` : '<HRONAUT_MCP_TOKEN>'
  const headers = authenticationDisabled ? undefined : { Authorization: `Bearer ${placeholder}` }
  const environmentSetup = !authenticationDisabled && tokenSetup ? { setupCommand: tokenSetup.trimEnd() } : {}
  const json = (value: unknown): string => JSON.stringify(value, null, 2)
  const server = (value: object): string => json({ mcpServers: { hronaut: value } })
  const fileHeaders = (fallback: string, prefix = ''): { Authorization: string } | undefined => authenticationDisabled
    ? undefined : { Authorization: tokenPath ? `Bearer ${prefix}{file:${tokenPath}}` : fallback }
  return [
    { id: 'codex', name: 'Codex', note: notes.codex, location: '~/.codex/config.toml',
      code: authenticationDisabled ? `codex mcp add hronaut --url ${endpoint}` : `${tokenSetup}codex mcp add hronaut --url ${endpoint} --bearer-token-env-var HRONAUT_MCP_TOKEN`, verifyCommand: 'codex mcp list' },
    { id: 'claude-code', name: 'Claude Code', note: notes.claudeCode, location: '~/.claude.json',
      code: authenticationDisabled ? `claude mcp add --transport http --scope user hronaut ${endpoint}` : `${tokenSetup}claude mcp add --transport http --scope user --header "Authorization: Bearer ${tokenReference}" hronaut ${endpoint}`, verifyCommand: 'claude mcp get hronaut' },
    { id: 'cursor', name: 'Cursor', note: notes.cursor, location: '~/.cursor/mcp.json', code: server({ url: endpoint, headers }) },
    { id: 'vscode', name: 'VS Code / Copilot', note: notes.vscode, location: '.vscode/mcp.json', code: json({ servers: { hronaut: { type: 'http', url: endpoint, headers } } }), ...(authenticationDisabled ? { action: 'open-vscode-install' as const } : {}) },
    { id: 'opencode', name: 'OpenCode', note: notes.opencode, location: '~/.config/opencode/opencode.json',
      code: json({ $schema: 'https://opencode.ai/config.json', mcp: { hronaut: { type: 'remote', url: endpoint, enabled: true, oauth: false, headers: fileHeaders(`Bearer ${placeholder}`) } } }), verifyCommand: 'opencode mcp list' },
    { id: 'gemini-cli', name: 'Gemini CLI', note: notes.geminiCli, location: '~/.gemini/settings.json', code: server({ httpUrl: endpoint, headers }), verifyCommand: 'gemini mcp list' },
    { id: 'goose', name: 'Goose', note: notes.goose, location: windows ? '%APPDATA%\\Block\\goose\\config\\config.yaml' : '~/.config/goose/config.yaml',
      code: ['extensions:', '  hronaut:', '    type: streamable_http', '    name: hronaut', '    enabled: true', `    uri: ${json(endpoint)}`,
        ...(authenticationDisabled ? ['    headers: {}', '    env_keys: []'] : ['    headers:', '      Authorization: "Bearer ${HRONAUT_MCP_TOKEN}"', '    env_keys:', '      - HRONAUT_MCP_TOKEN']), '    envs: {}', '    timeout: 300'].join('\n'), ...environmentSetup, verifyCommand: 'goose info -v' },
    { id: 'cline', name: 'Cline', note: notes.cline, location: 'Cline MCP settings', code: server({ type: 'streamableHttp', url: endpoint, headers, disabled: false, autoApprove: [] }), verifyCommand: 'cline config mcp --json' },
    { id: 'zoo-code', name: 'Zoo Code', note: notes.zooCode, location: 'Zoo Code → MCP Servers → Edit Global MCP', code: server({ type: 'streamable-http', url: endpoint, ...(!authenticationDisabled && { headers: { Authorization: 'Bearer ${env:HRONAUT_MCP_TOKEN}' } }), alwaysAllow: [], disabled: false }), ...environmentSetup, verifyCommand: 'Zoo Code → MCP Servers: hronaut is connected' },
    { id: 'kiro', name: 'Kiro', note: notes.kiro, location: '~/.kiro/settings/mcp.json', code: server({ url: endpoint, ...(!authenticationDisabled && { headers: { Authorization: 'Bearer ${HRONAUT_MCP_TOKEN}' } }), disabled: false, autoApprove: [] }), ...environmentSetup, verifyCommand: 'Kiro MCP panel: hronaut is connected' },
    { id: 'kilo', name: 'Kilo Code', note: notes.kilo, location: '~/.config/kilo/kilo.jsonc', code: json({ $schema: 'https://app.kilo.ai/config.json', mcp: { hronaut: { type: 'remote', url: endpoint, enabled: true, oauth: false, headers: fileHeaders('Bearer {env:HRONAUT_MCP_TOKEN}') } } }), verifyCommand: 'kilo mcp list' },
    { id: 'jetbrains-junie', name: 'JetBrains Junie', note: notes.jetbrainsJunie, location: '~/.junie/mcp/mcp.json', code: server({ url: endpoint, headers }), verifyCommand: '/mcp' },
    { id: 'devin-local', name: 'Devin Local', note: notes.devinLocal, location: windows ? '%APPDATA%\\devin\\mcp_config.json' : '~/.config/devin/mcp_config.json', code: server({ url: endpoint, transport: 'http', headers: fileHeaders(`Bearer ${placeholder}`, '$') }), verifyCommand: 'devin mcp list && devin mcp get hronaut' },
    { id: 'zed', name: 'Zed', note: notes.zed, location: 'Zed user settings.json', code: json({ context_servers: { hronaut: { url: endpoint, headers: authenticationDisabled ? { Authorization: 'Hronaut local-no-auth' } : headers } } }), verifyCommand: 'Settings → AI → MCP Servers: Server is active' },
    { id: 'mistral-vibe', name: 'Mistral Vibe', note: notes.mistralVibe, location: '~/.vibe/config.toml', code: ['[[mcp_servers]]', 'name = "hronaut"', 'transport = "streamable-http"', `url = ${json(endpoint)}`, ...(!authenticationDisabled ? ['api_key_env = "HRONAUT_MCP_TOKEN"', 'api_key_header = "Authorization"', 'api_key_format = "Bearer {token}"'] : [])].join('\n'), ...environmentSetup, verifyCommand: '/mcp hronaut' },
    { id: 'warp', name: 'Warp', note: notes.warp, location: '~/.warp/.mcp.json', code: server({ url: endpoint, headers }), verifyCommand: 'Settings → Agents → MCP servers: hronaut is running' },
    { id: 'windsurf', name: 'Windsurf', note: notes.windsurf, location: '~/.codeium/windsurf/mcp_config.json', code: server({ serverUrl: endpoint, headers: fileHeaders('Bearer ${env:HRONAUT_MCP_TOKEN}', '$') }), verifyCommand: 'Cascade → MCPs: hronaut is connected' },
    { id: 'grok-build', name: 'Grok Build', note: notes.grokBuild, location: '~/.grok/config.toml', code: `grok mcp add --transport http hronaut ${endpoint}${authenticationDisabled ? '' : " --header 'Authorization: Bearer ${HRONAUT_MCP_TOKEN}'"}`, ...environmentSetup, verifyCommand: 'grok mcp doctor hronaut' },
    { id: 'qwen-code', name: 'Qwen Code', note: notes.qwenCode, location: '~/.qwen/settings.json', code: authenticationDisabled ? `qwen mcp add --scope user --transport http hronaut ${endpoint}` : server({ httpUrl: endpoint, headers: { Authorization: 'Bearer ${HRONAUT_MCP_TOKEN}' }, trust: false }), ...environmentSetup, verifyCommand: 'qwen mcp list' },
    { id: 'generic', name: 'Generic MCP client', note: notes.generic, location: notes.genericLocation, code: json({ name: 'hronaut', transport: 'streamable-http', url: endpoint, headers }) }
  ]
}

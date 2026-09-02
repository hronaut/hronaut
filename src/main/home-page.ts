import type { McpDashboardState } from './mcp/server.js'
import { localeMessages } from '../shared/i18n.js'
import type { SupportedLocale } from '../shared/locale.js'

interface HomePageOptions {
  endpoint: string
  tokenPath?: string
  authenticationDisabled?: boolean
  initialState: McpDashboardState
  locale: SupportedLocale
  platform?: NodeJS.Platform
}

interface AgentGuide {
  id: string
  name: string
  note: string
  location: string
  code: string
  setupCommand?: string
  verifyCommand?: string
  action?: 'open-vscode-install'
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function serialized(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c')
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function powershellQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function agentGuides(
  endpoint: string,
  locale: SupportedLocale,
  tokenPath?: string,
  authenticationDisabled = false,
  platform: NodeJS.Platform = process.platform
): AgentGuide[] {
  const home = localeMessages[locale].home
  const windows = platform === 'win32'
  const tokenSetup = tokenPath
    ? windows
      ? `$env:HRONAUT_MCP_TOKEN = (Get-Content -Raw ${powershellQuote(tokenPath)}).Trim()\n`
      : `export HRONAUT_MCP_TOKEN="$(cat ${shellQuote(tokenPath)})"\n`
    : ''
  const tokenEnvironmentSetup = tokenSetup.trimEnd()
  const tokenEnvironmentReference = windows ? '$env:HRONAUT_MCP_TOKEN' : '$HRONAUT_MCP_TOKEN'
  const tokenPlaceholder = tokenPath ? `<paste token from ${tokenPath}>` : '<HRONAUT_MCP_TOKEN>'
  const headers = authenticationDisabled ? undefined : { Authorization: `Bearer ${tokenPlaceholder}` }
  const openCodeHeaders = authenticationDisabled
    ? undefined
    : tokenPath
      ? { Authorization: `Bearer {file:${tokenPath}}` }
      : headers
  const kiloHeaders = authenticationDisabled
    ? undefined
    : { Authorization: tokenPath ? `Bearer {file:${tokenPath}}` : 'Bearer {env:HRONAUT_MCP_TOKEN}' }
  const devinHeaders = authenticationDisabled
    ? undefined
    : {
        Authorization: tokenPath
          ? `Bearer \${file:${tokenPath}}`
          : `Bearer ${tokenPlaceholder}`
      }
  const zedHeaders = authenticationDisabled
    ? { Authorization: 'Hronaut local-no-auth' }
    : headers
  const windsurfHeaders = authenticationDisabled
    ? undefined
    : {
        Authorization: tokenPath
          ? `Bearer \${file:${tokenPath}}`
          : 'Bearer ${env:HRONAUT_MCP_TOKEN}'
      }
  return [
    {
      id: 'codex',
      name: 'Codex',
      note: home.connect.guides.codex,
      location: '~/.codex/config.toml',
      code: authenticationDisabled
        ? `codex mcp add hronaut --url ${endpoint}`
        : `${tokenSetup}codex mcp add hronaut --url ${endpoint} --bearer-token-env-var HRONAUT_MCP_TOKEN`,
      verifyCommand: 'codex mcp list'
    },
    {
      id: 'claude-code',
      name: 'Claude Code',
      note: home.connect.guides.claudeCode,
      location: '~/.claude.json',
      code: authenticationDisabled
        ? `claude mcp add --transport http --scope user hronaut ${endpoint}`
        : `${tokenSetup}claude mcp add --transport http --scope user --header "Authorization: Bearer ${tokenEnvironmentReference}" hronaut ${endpoint}`,
      verifyCommand: 'claude mcp get hronaut'
    },
    {
      id: 'cursor',
      name: 'Cursor',
      note: home.connect.guides.cursor,
      location: '~/.cursor/mcp.json',
      code: JSON.stringify({ mcpServers: { hronaut: { url: endpoint, ...(headers && { headers }) } } }, null, 2)
    },
    {
      id: 'vscode',
      name: 'VS Code / Copilot',
      note: home.connect.guides.vscode,
      location: '.vscode/mcp.json',
      code: JSON.stringify({ servers: { hronaut: { type: 'http', url: endpoint, ...(headers && { headers }) } } }, null, 2),
      ...(authenticationDisabled && { action: 'open-vscode-install' as const })
    },
    {
      id: 'opencode',
      name: 'OpenCode',
      note: home.connect.guides.opencode,
      location: '~/.config/opencode/opencode.json',
      code: JSON.stringify({
        $schema: 'https://opencode.ai/config.json',
        mcp: {
          hronaut: {
            type: 'remote',
            url: endpoint,
            enabled: true,
            oauth: false,
            ...(openCodeHeaders && { headers: openCodeHeaders })
          }
        }
      }, null, 2),
      verifyCommand: 'opencode mcp list'
    },
    {
      id: 'gemini-cli',
      name: 'Gemini CLI',
      note: home.connect.guides.geminiCli,
      location: '~/.gemini/settings.json',
      code: JSON.stringify({
        mcpServers: {
          hronaut: {
            httpUrl: endpoint,
            ...(headers && { headers })
          }
        }
      }, null, 2),
      verifyCommand: 'gemini mcp list'
    },
    {
      id: 'cline',
      name: 'Cline',
      note: home.connect.guides.cline,
      location: 'Cline MCP settings',
      code: JSON.stringify({
        mcpServers: {
          hronaut: {
            type: 'streamableHttp',
            url: endpoint,
            ...(headers && { headers }),
            disabled: false,
            autoApprove: []
          }
        }
      }, null, 2),
      verifyCommand: 'cline config mcp --json'
    },
    {
      id: 'kiro',
      name: 'Kiro',
      note: home.connect.guides.kiro,
      location: '~/.kiro/settings/mcp.json',
      code: JSON.stringify({
        mcpServers: {
          hronaut: {
            url: endpoint,
            ...(!authenticationDisabled && {
              headers: { Authorization: 'Bearer ${HRONAUT_MCP_TOKEN}' }
            }),
            disabled: false,
            autoApprove: []
          }
        }
      }, null, 2),
      ...(!authenticationDisabled && tokenEnvironmentSetup && { setupCommand: tokenEnvironmentSetup }),
      verifyCommand: 'Kiro MCP panel: hronaut is connected'
    },
    {
      id: 'kilo',
      name: 'Kilo Code',
      note: home.connect.guides.kilo,
      location: '~/.config/kilo/kilo.jsonc',
      code: JSON.stringify({
        $schema: 'https://app.kilo.ai/config.json',
        mcp: {
          hronaut: {
            type: 'remote',
            url: endpoint,
            enabled: true,
            oauth: false,
            ...(kiloHeaders && { headers: kiloHeaders })
          }
        }
      }, null, 2),
      verifyCommand: 'kilo mcp list'
    },
    {
      id: 'jetbrains-junie',
      name: 'JetBrains Junie',
      note: home.connect.guides.jetbrainsJunie,
      location: '~/.junie/mcp/mcp.json',
      code: JSON.stringify({
        mcpServers: {
          hronaut: {
            url: endpoint,
            ...(headers && { headers })
          }
        }
      }, null, 2),
      verifyCommand: '/mcp'
    },
    {
      id: 'devin-local',
      name: 'Devin Local',
      note: home.connect.guides.devinLocal,
      location: windows ? '%APPDATA%\\devin\\mcp_config.json' : '~/.config/devin/mcp_config.json',
      code: JSON.stringify({
        mcpServers: {
          hronaut: {
            url: endpoint,
            transport: 'http',
            ...(devinHeaders && { headers: devinHeaders })
          }
        }
      }, null, 2),
      verifyCommand: 'devin mcp list && devin mcp get hronaut'
    },
    {
      id: 'zed',
      name: 'Zed',
      note: home.connect.guides.zed,
      location: 'Zed user settings.json',
      code: JSON.stringify({
        context_servers: {
          hronaut: {
            url: endpoint,
            headers: zedHeaders
          }
        }
      }, null, 2),
      verifyCommand: 'Settings → AI → MCP Servers: Server is active'
    },
    {
      id: 'mistral-vibe',
      name: 'Mistral Vibe',
      note: home.connect.guides.mistralVibe,
      location: '~/.vibe/config.toml',
      code: [
        '[[mcp_servers]]',
        'name = "hronaut"',
        'transport = "streamable-http"',
        `url = ${JSON.stringify(endpoint)}`,
        ...(!authenticationDisabled
          ? [
              'api_key_env = "HRONAUT_MCP_TOKEN"',
              'api_key_header = "Authorization"',
              'api_key_format = "Bearer {token}"'
            ]
          : [])
      ].join('\n'),
      ...(!authenticationDisabled && tokenEnvironmentSetup && { setupCommand: tokenEnvironmentSetup }),
      verifyCommand: '/mcp hronaut'
    },
    {
      id: 'warp',
      name: 'Warp',
      note: home.connect.guides.warp,
      location: '~/.warp/.mcp.json',
      code: JSON.stringify({
        mcpServers: {
          hronaut: {
            url: endpoint,
            ...(headers && { headers })
          }
        }
      }, null, 2),
      verifyCommand: 'Settings → Agents → MCP servers: hronaut is running'
    },
    {
      id: 'windsurf',
      name: 'Windsurf',
      note: home.connect.guides.windsurf,
      location: '~/.codeium/windsurf/mcp_config.json',
      code: JSON.stringify({
        mcpServers: {
          hronaut: {
            serverUrl: endpoint,
            ...(windsurfHeaders && { headers: windsurfHeaders })
          }
        }
      }, null, 2),
      verifyCommand: 'Cascade → MCPs: hronaut is connected'
    },
    {
      id: 'generic',
      name: 'Generic MCP client',
      note: home.connect.guides.generic,
      location: home.connect.guides.genericLocation,
      code: JSON.stringify({ name: 'hronaut', transport: 'streamable-http', url: endpoint, ...(headers && { headers }) }, null, 2)
    }
  ]
}

export function renderHomePage(options: HomePageOptions): string {
  const home = localeMessages[options.locale].home
  const endpoint = escapeHtml(options.endpoint)
  const guides = agentGuides(
    options.endpoint,
    options.locale,
    options.tokenPath,
    options.authenticationDisabled,
    options.platform
  )
  const securityNote = options.authenticationDisabled
    ? home.security.disabled
    : options.tokenPath
    ? home.security.tokenFile.replace('{path}', options.tokenPath)
    : home.security.tokenEnvironment

  return `<!doctype html>
<html lang="${options.locale}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(home.title)}</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --bg: #f5f5fa;
      --panel: rgba(255,255,255,.84);
      --panel-solid: #fff;
      --text: #20202b;
      --muted: #6f6c7c;
      --border: #dedce8;
      --soft: #f0eef7;
      --accent: #6757e8;
      --accent-2: #26a67a;
      --code: #171821;
      --code-text: #eeeff7;
      --shadow: 0 14px 40px rgba(38,31,75,.08);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #12131a;
        --panel: rgba(30,31,42,.9);
        --panel-solid: #1e1f2a;
        --text: #f1f1f6;
        --muted: #aaa8b7;
        --border: #353645;
        --soft: #262733;
        --accent: #9b8cff;
        --accent-2: #42d392;
        --code: #0d0e13;
        --code-text: #f3f3f8;
        --shadow: 0 18px 55px rgba(0,0,0,.28);
      }
    }
    * { box-sizing: border-box; }
    html { min-width: 320px; min-height: 100%; background: var(--bg); }
    body { min-height: 100vh; margin: 0; color: var(--text); background: radial-gradient(circle at 75% -15%, color-mix(in srgb, var(--accent) 13%, transparent), transparent 35%), var(--bg); }
    button { color: inherit; font: inherit; }
    .page { width: min(1180px, calc(100% - 48px)); margin: 0 auto; padding: 42px 0 56px; }
    .hero { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 28px; align-items: end; padding: 8px 2px 30px; }
    .brand { display: inline-flex; align-items: center; gap: 9px; margin-bottom: 20px; color: var(--muted); font-size: 14px; font-weight: 750; letter-spacing: .12em; text-transform: uppercase; }
    .mark { display: grid; width: 29px; height: 29px; place-items: center; border-radius: 9px; color: white; background: linear-gradient(135deg, var(--accent), #4f8cff); box-shadow: 0 7px 18px color-mix(in srgb, var(--accent) 30%, transparent); font-size: 15px; letter-spacing: 0; }
    h1 { max-width: 760px; margin: 0; font-size: clamp(36px, 5vw, 64px); line-height: .99; letter-spacing: -.055em; }
    .lead { max-width: 720px; margin: 18px 0 0; color: var(--muted); font-size: 18px; line-height: 1.65; }
    .hero-status { min-width: 220px; padding: 17px 18px; border: 1px solid var(--border); border-radius: 16px; background: var(--panel); box-shadow: var(--shadow); backdrop-filter: blur(12px); }
    .status-label { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent-2); box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent-2) 14%, transparent); }
    .dot.starting { background: #4f8cff; box-shadow: 0 0 0 4px color-mix(in srgb, #4f8cff 16%, transparent); }
    .dot.paused { background: #e7a33c; box-shadow: 0 0 0 4px color-mix(in srgb, #e7a33c 16%, transparent); }
    .dot.error { background: #df4b5f; box-shadow: 0 0 0 4px color-mix(in srgb, #df4b5f 18%, transparent); }
    .status-value { display: block; margin-top: 10px; font-size: 24px; font-weight: 760; letter-spacing: -.03em; }
    .status-detail { display: block; margin-top: 5px; color: var(--muted); font-size: 13px; }
    .endpoint { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; padding: 13px 14px 13px 18px; border: 1px solid var(--border); border-radius: 14px; background: var(--panel); box-shadow: var(--shadow); }
    .endpoint-label { flex: 0 0 auto; color: var(--muted); font-size: 12px; font-weight: 750; letter-spacing: .1em; text-transform: uppercase; }
    .endpoint code { min-width: 0; flex: 1; overflow: hidden; color: var(--text); font-family: "SFMono-Regular", Consolas, monospace; font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }
    .copy-button { flex: 0 0 auto; padding: 9px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--panel-solid); cursor: pointer; font-size: 13px; font-weight: 700; }
    .copy-button:hover { border-color: var(--accent); color: var(--accent); }
    .grid { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(290px, .7fr); gap: 20px; }
    .panel { overflow: hidden; border: 1px solid var(--border); border-radius: 18px; background: var(--panel); box-shadow: var(--shadow); backdrop-filter: blur(12px); }
    .panel-heading { display: flex; align-items: start; justify-content: space-between; gap: 18px; padding: 22px 24px 18px; border-bottom: 1px solid var(--border); }
    h2 { margin: 0; font-size: 18px; letter-spacing: -.02em; }
    .panel-heading p { margin: 5px 0 0; color: var(--muted); font-size: 14px; line-height: 1.5; }
    .count { flex: 0 0 auto; padding: 5px 9px; border-radius: 999px; color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); font-size: 12px; font-weight: 800; }
    .agent-layout { display: grid; min-height: 360px; grid-template-columns: 180px minmax(0,1fr); }
    .agents { padding: 12px; border-right: 1px solid var(--border); background: color-mix(in srgb, var(--soft) 55%, transparent); }
    .agent-button { display: block; width: 100%; padding: 11px 12px; border: 1px solid transparent; border-radius: 9px; background: transparent; text-align: left; cursor: pointer; font-size: 14px; font-weight: 680; }
    .agent-button + .agent-button { margin-top: 3px; }
    .agent-button:hover { background: var(--panel-solid); }
    .agent-button.active { border-color: var(--border); color: var(--accent); background: var(--panel-solid); box-shadow: 0 3px 10px rgba(0,0,0,.05); }
    .guide { min-width: 0; padding: 24px; }
    .guide-kicker { color: var(--accent); font-size: 12px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
    .guide h3 { margin: 7px 0 0; font-size: 21px; letter-spacing: -.025em; }
    .guide-note { min-height: 42px; margin: 7px 0 15px; color: var(--muted); font-size: 14px; line-height: 1.55; }
    .location { margin-bottom: 8px; color: var(--muted); font-size: 12px; }
    .code-wrap { position: relative; }
    pre { min-height: 126px; margin: 0; padding: 19px 54px 19px 18px; overflow: auto; border-radius: 12px; color: var(--code-text); background: var(--code); font: 12px/1.7 "SFMono-Regular", Consolas, monospace; white-space: pre-wrap; word-break: break-word; }
    .code-copy { position: absolute; top: 10px; right: 10px; border-color: rgba(255,255,255,.16); color: #f4f4f8; background: rgba(255,255,255,.08); }
    .security { margin: 13px 0 0; color: var(--muted); font-size: 12px; line-height: 1.5; }
    .verify { display: flex; align-items: center; gap: 9px; margin-top: 12px; }
    .verify[hidden] { display: none; }
    .verify-label { flex: 0 0 auto; color: var(--muted); font-size: 12px; font-weight: 750; }
    .verify code { min-width: 0; flex: 1; overflow: hidden; padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; color: var(--text); background: var(--soft); font: 12px "SFMono-Regular", Consolas, monospace; text-overflow: ellipsis; white-space: nowrap; }
    .verify .copy-button { padding: 7px 10px; }
    .guide-primary-action { display: flex; align-items: center; gap: 10px; margin-top: 12px; }
    .guide-primary-action[hidden] { display: none; }
    .guide-primary-action button { flex: 0 0 auto; padding: 9px 13px; border: 1px solid var(--accent); border-radius: 9px; color: white; background: var(--accent); cursor: pointer; font-size: 13px; font-weight: 780; }
    .guide-primary-action button:hover { filter: brightness(1.08); }
    .guide-primary-action button:disabled { cursor: wait; opacity: .72; }
    .guide-primary-status { min-width: 0; color: var(--muted); font-size: 12px; line-height: 1.4; }
    .connections-body { min-height: 360px; padding: 10px 14px 14px; }
    .first-run { display: grid; grid-template-columns: minmax(230px,.62fr) minmax(0,1.38fr); gap: 22px; align-items: center; margin-top: 20px; padding: 22px 24px; }
    .first-run-kicker { color: var(--accent); font-size: 12px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
    .first-run h2 { margin-top: 7px; }
    .first-run p { margin: 7px 0 0; color: var(--muted); font-size: 13px; line-height: 1.55; }
    .first-run .code-wrap { min-width: 0; }
    .first-run pre { min-height: 0; padding-right: 130px; }
    .empty { display: grid; min-height: 250px; place-items: center; padding: 30px; color: var(--muted); text-align: center; }
    .empty strong { display: block; color: var(--text); font-size: 15px; }
    .empty span { display: block; max-width: 280px; margin-top: 6px; font-size: 13px; line-height: 1.55; }
    .connection { display: grid; grid-template-columns: auto minmax(0,1fr) auto; gap: 11px; align-items: center; padding: 12px 8px; border-bottom: 1px solid var(--border); }
    .connection:last-child { border-bottom: 0; }
    .client-icon { display: grid; width: 34px; height: 34px; place-items: center; border-radius: 10px; color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); font-size: 13px; font-weight: 800; }
    .client-name { overflow: hidden; font-size: 14px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
    .client-meta { margin-top: 3px; color: var(--muted); font-size: 12px; }
    .connection-state { padding: 4px 7px; border-radius: 999px; color: var(--muted); background: var(--soft); font-size: 12px; font-weight: 750; }
    .connection-state.active { color: var(--accent-2); background: color-mix(in srgb, var(--accent-2) 12%, transparent); }
    .tools { margin-top: 20px; }
    .activity { margin-top: 20px; }
    .impact-grid { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 10px; padding: 18px 18px 0; }
    .impact { padding: 17px; border: 1px solid var(--border); border-radius: 12px; background: color-mix(in srgb, var(--panel-solid) 72%, transparent); }
    .impact strong { display: block; font-size: 25px; letter-spacing: -.04em; }
    .impact span { display: block; margin-top: 4px; color: var(--muted); font-size: 12px; font-weight: 750; letter-spacing: .07em; text-transform: uppercase; }
    .activity-layout { display: grid; grid-template-columns: minmax(0,1.35fr) minmax(260px,.65fr); gap: 18px; padding: 18px; }
    .activity-column { min-width: 0; }
    .activity-column h3 { margin: 0 0 10px; font-size: 14px; }
    .activity-list { overflow: hidden; border: 1px solid var(--border); border-radius: 12px; }
    .activity-list .empty { min-height: 130px; }
    .activity-item { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 12px; padding: 11px 13px; border-bottom: 1px solid var(--border); }
    .activity-item:last-child { border-bottom: 0; }
    .activity-item code { overflow: hidden; color: var(--text); font: 700 11px "SFMono-Regular", Consolas, monospace; text-overflow: ellipsis; white-space: nowrap; }
    .activity-meta { margin-top: 4px; color: var(--muted); font-size: 12px; }
    .outcome { align-self: center; color: var(--accent-2); font-size: 12px; font-weight: 800; }
    .outcome.failed { color: #df625e; }
    .privacy-note { margin: 10px 2px 0; color: var(--muted); font-size: 12px; line-height: 1.5; }
    .support-card { height: 100%; padding: 18px; border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border)); border-radius: 12px; background: radial-gradient(circle at 100% 0, color-mix(in srgb, var(--accent) 14%, transparent), transparent 45%), var(--soft); }
    .support-card span { color: var(--accent); font-size: 12px; font-weight: 800; letter-spacing: .09em; text-transform: uppercase; }
    .support-card h3 { margin: 9px 0; font-size: 17px; line-height: 1.2; }
    .support-card p { margin: 0 0 15px; color: var(--muted); font-size: 13px; line-height: 1.55; }
    .support-card a { display: block; padding: 10px 12px; border-radius: 8px; color: white; background: var(--accent); text-align: center; text-decoration: none; font-size: 13px; font-weight: 800; }
    .support-card small { display: block; margin-top: 10px; color: var(--muted); font-size: 12px; line-height: 1.45; text-align: center; }
    .tool-grid { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 10px; padding: 18px; }
    .tool { min-width: 0; padding: 15px; border: 1px solid var(--border); border-radius: 12px; background: color-mix(in srgb, var(--panel-solid) 72%, transparent); }
    .tool-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .tool code { overflow: hidden; color: var(--text); font: 700 12px "SFMono-Regular", Consolas, monospace; text-overflow: ellipsis; white-space: nowrap; }
    .category { flex: 0 0 auto; color: var(--accent); font-size: 12px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
    .tool p { margin: 8px 0 0; color: var(--muted); font-size: 13px; line-height: 1.5; }
    .footer { display: flex; justify-content: space-between; gap: 16px; padding: 24px 3px 0; color: var(--muted); font-size: 12px; }
    @media (max-width: 880px) {
      .page { width: min(100% - 28px, 720px); padding-top: 24px; }
      .hero { grid-template-columns: 1fr; }
      .hero-status { min-width: 0; }
      .grid { grid-template-columns: 1fr; }
      .first-run { grid-template-columns: 1fr; }
      .activity-layout { grid-template-columns: 1fr; }
      .tool-grid { grid-template-columns: repeat(2, minmax(0,1fr)); }
    }
    @media (max-width: 560px) {
      .agent-layout { display: block; }
      .agents { display: flex; overflow-x: auto; border-right: 0; border-bottom: 1px solid var(--border); }
      .agent-button { width: auto; flex: 0 0 auto; }
      .agent-button + .agent-button { margin: 0 0 0 3px; }
      .tool-grid { grid-template-columns: 1fr; }
      .impact-grid { grid-template-columns: 1fr; }
      .endpoint-label { display: none; }
      .footer { display: block; }
      .footer span { display: block; margin-top: 5px; }
    }
  </style>
</head>
<body>
  <main class="page">
    <section class="hero">
      <div>
        <div class="brand"><span class="mark">H</span> ${escapeHtml(home.brand)}</div>
        <h1>${escapeHtml(home.hero)}</h1>
        <p class="lead">${escapeHtml(home.lead)}</p>
      </div>
      <div class="hero-status" aria-live="polite">
        <span id="server-state" class="status-label"><span class="dot"></span> ${escapeHtml(home.status.online)}</span>
        <strong id="active-count" class="status-value">${escapeHtml(home.status.activeOther.replace('{count}', '0'))}</strong>
        <span id="request-count" class="status-detail">${escapeHtml(home.status.waiting)}</span>
      </div>
    </section>

    <div class="endpoint">
      <span class="endpoint-label">${escapeHtml(home.endpoint)}</span>
      <code id="endpoint">${endpoint}</code>
      <button class="copy-button" type="button" data-copy-target="endpoint">${escapeHtml(home.copyUrl)}</button>
    </div>

    <div class="grid">
      <section class="panel" aria-labelledby="connect-title">
        <header class="panel-heading">
          <div><h2 id="connect-title">${escapeHtml(home.connect.heading)}</h2><p>${escapeHtml(home.connect.description)}</p></div>
          <span class="count">${escapeHtml(home.connect.clients)}</span>
        </header>
        <div class="agent-layout">
          <nav id="agent-list" class="agents" aria-label="${escapeHtml(home.connect.agentsLabel)}"></nav>
          <div class="guide">
            <span class="guide-kicker">${escapeHtml(home.connect.instructions)}</span>
            <h3 id="guide-name"></h3>
            <p id="guide-note" class="guide-note"></p>
            <div id="guide-location" class="location"></div>
            <div class="code-wrap">
              <pre><code id="guide-code"></code></pre>
              <button class="copy-button code-copy" type="button" data-copy-target="guide-code">${escapeHtml(home.connect.copy)}</button>
            </div>
            <div id="guide-setup" class="verify" hidden>
              <span class="verify-label">${escapeHtml(home.connect.beforeLaunch)}</span>
              <code id="guide-setup-command"></code>
              <button class="copy-button" type="button" data-copy-target="guide-setup-command">${escapeHtml(home.connect.copy)}</button>
            </div>
            <div id="guide-verify" class="verify" hidden>
              <span class="verify-label">${escapeHtml(home.connect.verify)}</span>
              <code id="guide-verify-command"></code>
              <button class="copy-button" type="button" data-copy-target="guide-verify-command">${escapeHtml(home.connect.copy)}</button>
            </div>
            ${options.authenticationDisabled ? `<div id="guide-primary-action" class="guide-primary-action" hidden>
              <button type="button" data-vscode-install>${escapeHtml(home.connect.openVsCode)}</button>
              <span id="guide-primary-status" class="guide-primary-status" aria-live="polite"></span>
            </div>` : ''}
            <p class="security">${escapeHtml(securityNote)}</p>
          </div>
        </div>
      </section>

      <section class="panel" aria-labelledby="connections-title">
        <header class="panel-heading">
          <div><h2 id="connections-title">${escapeHtml(home.connections.heading)}</h2><p>${escapeHtml(home.connections.description)}</p></div>
          <span id="client-count" class="count">${escapeHtml(home.counts.clientsOther.replace('{count}', '0'))}</span>
        </header>
        <div id="connections" class="connections-body"></div>
      </section>
    </div>

    <section class="panel first-run" aria-labelledby="first-run-title">
      <div>
        <span class="first-run-kicker">${escapeHtml(home.firstRun.kicker)}</span>
        <h2 id="first-run-title">${escapeHtml(home.firstRun.heading)}</h2>
        <p>${escapeHtml(home.firstRun.description)}</p>
      </div>
      <div class="code-wrap">
        <pre><code id="first-run-prompt">${escapeHtml(home.firstRun.prompt)}</code></pre>
        <button class="copy-button code-copy" type="button" data-copy-target="first-run-prompt">${escapeHtml(home.firstRun.copy)}</button>
      </div>
    </section>

    <section class="panel activity" aria-labelledby="activity-title">
      <header class="panel-heading">
        <div><h2 id="activity-title">${escapeHtml(home.activity.heading)}</h2><p>${escapeHtml(home.activity.description)}</p></div>
        <span id="activity-count" class="count">${escapeHtml(home.counts.actionsOther.replace('{count}', '0'))}</span>
      </header>
      <div class="impact-grid">
        <div class="impact"><strong id="completed-count">0</strong><span>${escapeHtml(home.activity.tabActionsCompleted)}</span></div>
        <div class="impact"><strong id="tool-types-count">0</strong><span>${escapeHtml(home.activity.toolsUsed)}</span></div>
        <div class="impact"><strong id="success-rate">—</strong><span>${escapeHtml(home.activity.successfulActions)}</span></div>
      </div>
      <div class="activity-layout">
        <div class="activity-column">
          <h3>${escapeHtml(home.activity.recent)}</h3>
          <div id="activity-list" class="activity-list"></div>
          <p class="privacy-note">${escapeHtml(home.activity.privacy)}</p>
        </div>
        <aside class="support-card">
          <span>${escapeHtml(home.support.kicker)}</span>
          <h3 id="support-heading">${escapeHtml(home.support.heading)}</h3>
          <p id="support-message">${escapeHtml(home.support.message)}</p>
          <a href="https://github.com/hronaut/hronaut/blob/main/CONTRIBUTING.md" target="_blank" rel="noreferrer">${escapeHtml(home.support.contribute)}</a>
          <small>${escapeHtml(home.support.welcome)}</small>
        </aside>
      </div>
    </section>

    <section class="panel tools" aria-labelledby="tools-title">
      <header class="panel-heading">
        <div><h2 id="tools-title">${escapeHtml(home.tools.heading)}</h2><p>${escapeHtml(home.tools.description)}</p></div>
        <span id="tool-count" class="count">${escapeHtml(home.counts.tools.replace('{count}', '0'))}</span>
      </header>
      <div id="tool-grid" class="tool-grid"></div>
    </section>

    <footer class="footer"><span>${escapeHtml(home.footer)}</span><span id="server-version">Hronaut ${escapeHtml(options.initialState.version)}</span></footer>
  </main>
  <script>
    const guides = ${serialized(guides)};
    const messages = ${serialized(home)};
    const locale = ${serialized(options.locale)};
    let dashboard = ${serialized(options.initialState)};
    const renderedPresentationRevision = dashboard.presentationRevision;
    let selectedGuide = guides[0].id;
    const copyButtonStates = new WeakMap();
    let vscodeInstallSequence = 0;

    function resetCopyButton(button) {
      const state = copyButtonStates.get(button);
      if (!state) return;
      state.sequence += 1;
      if (state.timer !== undefined) clearTimeout(state.timer);
      state.timer = undefined;
      button.textContent = state.label;
      button.title = state.title;
    }

    function escapeText(value) {
      const node = document.createElement('span');
      node.textContent = String(value ?? '');
      return node.innerHTML;
    }

    function interpolate(message, values = {}) {
      let result = message;
      Object.entries(values).forEach(([name, value]) => {
        result = result.replaceAll('{' + name + '}', String(value));
      });
      return result;
    }

    function countMessage(one, other, count) {
      return interpolate(count === 1 ? one : other, { count: new Intl.NumberFormat(locale).format(count) });
    }

    function relativeTime(value) {
      const elapsed = Date.now() - new Date(value).getTime();
      if (elapsed < 5000) return messages.relativeTime.now;
      if (elapsed < 60000) return interpolate(messages.relativeTime.seconds, { count: new Intl.NumberFormat(locale).format(Math.floor(elapsed / 1000)) });
      if (elapsed < 3600000) return interpolate(messages.relativeTime.minutes, { count: new Intl.NumberFormat(locale).format(Math.floor(elapsed / 60000)) });
      return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
    }

    function duration(value) {
      if (value < 1000) return new Intl.NumberFormat(locale).format(value) + ' ms';
      if (value < 60000) return new Intl.NumberFormat(locale, { maximumFractionDigits: value < 10000 ? 1 : 0 }).format(value / 1000) + ' s';
      return new Intl.NumberFormat(locale).format(Math.round(value / 60000)) + ' min';
    }

    function renderGuide() {
      const guide = guides.find((item) => item.id === selectedGuide) || guides[0];
      const agentList = document.getElementById('agent-list');
      if (!agentList.childElementCount) {
        agentList.innerHTML = guides.map((item) =>
          '<button class="agent-button" type="button" data-guide="' + item.id + '" aria-pressed="false">' + escapeText(item.name) + '</button>'
        ).join('');
        agentList.querySelectorAll('[data-guide]').forEach((button) => button.addEventListener('click', () => {
          selectedGuide = button.dataset.guide;
          renderGuide();
        }));
      }
      agentList.querySelectorAll('[data-guide]').forEach((button) => {
        const active = button.dataset.guide === guide.id;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      });
      document.getElementById('guide-name').textContent = guide.name;
      document.getElementById('guide-note').textContent = guide.note;
      document.getElementById('guide-location').textContent = guide.location;
      document.getElementById('guide-code').textContent = guide.code;
      const setup = document.getElementById('guide-setup');
      const setupCommand = document.getElementById('guide-setup-command');
      setup.hidden = !guide.setupCommand;
      setupCommand.textContent = guide.setupCommand || '';
      const verify = document.getElementById('guide-verify');
      const verifyCommand = document.getElementById('guide-verify-command');
      verify.hidden = !guide.verifyCommand;
      verifyCommand.textContent = guide.verifyCommand || '';
      const primaryAction = document.getElementById('guide-primary-action');
      if (primaryAction) {
        const showPrimaryAction = guide.action === 'open-vscode-install';
        primaryAction.hidden = !showPrimaryAction;
        if (!showPrimaryAction) {
          vscodeInstallSequence += 1;
          const vscodeInstallButton = primaryAction.querySelector('[data-vscode-install]');
          vscodeInstallButton.disabled = false;
          vscodeInstallButton.title = '';
          document.getElementById('guide-primary-status').textContent = '';
        }
      }
      document.querySelectorAll('[data-copy-target^="guide-"]').forEach(resetCopyButton);
    }

    const vscodeInstallButton = document.querySelector('[data-vscode-install]');
    if (vscodeInstallButton) {
      vscodeInstallButton.addEventListener('click', async () => {
        if (vscodeInstallButton.disabled) return;
        const sequence = ++vscodeInstallSequence;
        const status = document.getElementById('guide-primary-status');
        vscodeInstallButton.disabled = true;
        vscodeInstallButton.title = '';
        status.textContent = messages.connect.openingVsCode;
        try {
          if (!window.hronautHome?.openVsCodeInstall) throw new Error(messages.connect.vscodeUnavailable);
          await window.hronautHome.openVsCodeInstall();
          if (sequence !== vscodeInstallSequence || selectedGuide !== 'vscode') return;
          status.textContent = messages.connect.vscodeOpened;
        } catch (error) {
          if (sequence !== vscodeInstallSequence || selectedGuide !== 'vscode') return;
          status.textContent = messages.connect.vscodeFailed;
          vscodeInstallButton.title = error instanceof Error ? error.message : messages.connect.vscodeUnavailable;
        } finally {
          if (sequence === vscodeInstallSequence) vscodeInstallButton.disabled = false;
        }
      });
    }

    function renderDashboard() {
      const active = dashboard.activeRequests;
      const serverState = document.getElementById('server-state');
      const status = dashboard.status || (dashboard.paused ? 'paused' : 'ready');
      const statusLabels = { starting: messages.status.starting, ready: messages.status.online, paused: messages.status.paused, error: messages.status.error };
      serverState.innerHTML = '<span class="dot ' + status + '"></span> ' + statusLabels[status];
      serverState.title = status === 'error' ? (dashboard.error || messages.status.unknownError) : '';
      document.getElementById('active-count').textContent = status === 'paused' ? messages.status.pausedValue : status === 'error' ? messages.status.unavailable : status === 'starting' ? messages.status.startingValue : countMessage(messages.status.activeOne, messages.status.activeOther, active);
      document.getElementById('request-count').textContent = dashboard.totalRequests
        ? countMessage(messages.counts.requestsOne, messages.counts.requestsOther, dashboard.totalRequests)
        : messages.status.waiting;
      document.getElementById('client-count').textContent = countMessage(messages.counts.clientsOne, messages.counts.clientsOther, dashboard.clients.length);
      document.getElementById('tool-count').textContent = interpolate(messages.counts.tools, { count: new Intl.NumberFormat(locale).format(dashboard.tools.length) });
      document.getElementById('server-version').textContent = 'Hronaut ' + dashboard.version;

      const completed = dashboard.completedToolCalls || 0;
      const failures = (dashboard.toolMetrics || []).reduce((total, metric) => total + metric.failures, 0);
      const successRate = completed ? new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format((completed - failures) / completed) : '—';
      document.getElementById('activity-count').textContent = countMessage(messages.counts.actionsOne, messages.counts.actionsOther, completed);
      document.getElementById('completed-count').textContent = new Intl.NumberFormat(locale).format(completed);
      document.getElementById('tool-types-count').textContent = new Intl.NumberFormat(locale).format((dashboard.toolMetrics || []).length);
      document.getElementById('success-rate').textContent = successRate;
      document.getElementById('support-heading').textContent = completed
        ? countMessage(messages.support.activeHeadingOne, messages.support.activeHeadingOther, completed)
        : messages.support.heading;
      document.getElementById('support-message').textContent = completed
        ? messages.support.activeMessage
        : messages.support.message;

      const activityList = document.getElementById('activity-list');
      if (!dashboard.recentActivity?.length) {
        activityList.innerHTML = '<div class="empty"><div><strong>' + escapeText(messages.activity.emptyHeading) + '</strong><span>' + escapeText(messages.activity.emptyDescription) + '</span></div></div>';
      } else {
        activityList.innerHTML = dashboard.recentActivity.slice(0, 8).map((activity) =>
          '<div class="activity-item"><div><code>' + escapeText(activity.toolName) + '</code><div class="activity-meta">' + escapeText(relativeTime(activity.completedAt)) + ' · ' + escapeText(duration(activity.durationMs)) + '</div></div><span class="outcome ' + (activity.outcome === 'failed' ? 'failed' : '') + '">' + (activity.outcome === 'failed' ? escapeText(messages.activity.failed) : escapeText(messages.activity.done)) + '</span></div>'
        ).join('');
      }

      const connections = document.getElementById('connections');
      if (!dashboard.clients.length) {
        connections.innerHTML = '<div class="empty"><div><strong>' + escapeText(messages.connections.emptyHeading) + '</strong><span>' + escapeText(messages.connections.emptyDescription) + '</span></div></div>';
      } else {
        connections.innerHTML = dashboard.clients.map((client) => {
          const activeClient = client.activeRequests > 0;
          const initial = (client.name || '?').trim().charAt(0).toUpperCase();
          return '<div class="connection"><span class="client-icon">' + escapeText(initial) + '</span><div><div class="client-name">' + escapeText(client.name) + '</div><div class="client-meta">' + escapeText(client.version || messages.connections.versionUnknown) + ' · ' + escapeText(relativeTime(client.lastSeenAt)) + ' · ' + escapeText(interpolate(messages.counts.requests, { count: new Intl.NumberFormat(locale).format(client.requestCount) })) + '</div></div><span class="connection-state ' + (activeClient ? 'active' : '') + '">' + (activeClient ? escapeText(messages.connections.active) : escapeText(messages.connections.recent)) + '</span></div>';
        }).join('');
      }

      document.getElementById('tool-grid').innerHTML = dashboard.tools.map((tool) =>
        '<article class="tool"><div class="tool-top"><code>' + escapeText(tool.name) + '</code><span class="category">' + escapeText(tool.category) + '</span></div><p>' + escapeText(tool.description) + '</p></article>'
      ).join('');
    }

    let dashboardRefreshSequence = 0;

    async function refreshDashboard() {
      const sequence = ++dashboardRefreshSequence;
      try {
        const response = await fetch('/api/status', { cache: 'no-store' });
        const nextDashboard = response.ok ? await response.json() : null;
        if (sequence !== dashboardRefreshSequence) return;
        if (nextDashboard && nextDashboard.presentationRevision !== renderedPresentationRevision) {
          window.location.reload();
          return;
        }
        if (nextDashboard) dashboard = nextDashboard;
        renderDashboard();
      } catch {
        if (sequence !== dashboardRefreshSequence) return;
        document.getElementById('request-count').textContent = messages.status.reconnecting;
      }
    }

    async function pollDashboard() {
      await refreshDashboard();
      setTimeout(pollDashboard, 2000);
    }

    document.querySelectorAll('[data-copy-target]').forEach((button) => {
      const state = {
        label: button.textContent,
        title: button.title,
        sequence: 0,
        timer: undefined
      };
      copyButtonStates.set(button, state);
      button.addEventListener('click', async () => {
        const target = document.getElementById(button.dataset.copyTarget);
        const value = target.textContent || '';
        const sequence = ++state.sequence;
        if (state.timer !== undefined) clearTimeout(state.timer);
        state.timer = undefined;
        button.title = state.title;
        try {
          if (!window.hronautHome?.copyText) throw new Error(messages.copy.unavailable);
          await window.hronautHome.copyText(value);
          if (sequence !== state.sequence || target.textContent !== value) return;
          button.textContent = messages.copy.copied;
        } catch (error) {
          if (sequence !== state.sequence || target.textContent !== value) return;
          button.textContent = messages.copy.failed;
          button.title = error instanceof Error ? error.message : messages.copy.rejected;
        }
        state.timer = setTimeout(() => {
          if (sequence !== state.sequence) return;
          state.timer = undefined;
          button.textContent = state.label;
          button.title = state.title;
        }, 1200);
      });
    });

    renderGuide();
    renderDashboard();
    pollDashboard();
  </script>
</body>
</html>`
}

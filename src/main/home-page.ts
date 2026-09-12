import type { McpDashboardState } from './mcp/server.js'
import { localeMessages } from '../shared/i18n.js'
import type { AgentGuideId } from '../shared/agent-guides.js'
import type { ResolvedThemeName } from '../shared/theme.js'
import { HOME_PAGE_STYLES } from './home-page-styles.js'
import type { SupportedLocale } from '../shared/locale.js'

interface HomePageOptions {
  endpoint: string
  tokenPath?: string
  authenticationDisabled?: boolean
  initialState: McpDashboardState & { theme?: ResolvedThemeName }
  locale: SupportedLocale
  platform?: NodeJS.Platform
}

interface AgentGuide {
  id: AgentGuideId
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
      id: 'goose',
      name: 'Goose',
      note: home.connect.guides.goose,
      location: windows ? '%APPDATA%\\Block\\goose\\config\\config.yaml' : '~/.config/goose/config.yaml',
      code: [
        'extensions:',
        '  hronaut:',
        '    type: streamable_http',
        '    name: hronaut',
        '    enabled: true',
        `    uri: ${JSON.stringify(endpoint)}`,
        ...(authenticationDisabled
          ? [
              '    headers: {}',
              '    env_keys: []'
            ]
          : [
              '    headers:',
              '      Authorization: "Bearer ${HRONAUT_MCP_TOKEN}"',
              '    env_keys:',
              '      - HRONAUT_MCP_TOKEN'
            ]),
        '    envs: {}',
        '    timeout: 300'
      ].join('\n'),
      ...(!authenticationDisabled && tokenEnvironmentSetup && { setupCommand: tokenEnvironmentSetup }),
      verifyCommand: 'goose info -v'
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
      id: 'zoo-code',
      name: 'Zoo Code',
      note: home.connect.guides.zooCode,
      location: 'Zoo Code → MCP Servers → Edit Global MCP',
      code: JSON.stringify({
        mcpServers: {
          hronaut: {
            type: 'streamable-http',
            url: endpoint,
            ...(!authenticationDisabled && {
              headers: { Authorization: 'Bearer ${env:HRONAUT_MCP_TOKEN}' }
            }),
            alwaysAllow: [],
            disabled: false
          }
        }
      }, null, 2),
      ...(!authenticationDisabled && tokenEnvironmentSetup && { setupCommand: tokenEnvironmentSetup }),
      verifyCommand: 'Zoo Code → MCP Servers: hronaut is connected'
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
      id: 'grok-build',
      name: 'Grok Build',
      note: home.connect.guides.grokBuild,
      location: '~/.grok/config.toml',
      code: authenticationDisabled
        ? `grok mcp add --transport http hronaut ${endpoint}`
        : `grok mcp add --transport http hronaut ${endpoint} --header 'Authorization: Bearer \${HRONAUT_MCP_TOKEN}'`,
      ...(!authenticationDisabled && tokenEnvironmentSetup && { setupCommand: tokenEnvironmentSetup }),
      verifyCommand: 'grok mcp doctor hronaut'
    },
    {
      id: 'qwen-code',
      name: 'Qwen Code',
      note: home.connect.guides.qwenCode,
      location: '~/.qwen/settings.json',
      code: authenticationDisabled
        ? `qwen mcp add --scope user --transport http hronaut ${endpoint}`
        : JSON.stringify({
            mcpServers: {
              hronaut: {
                httpUrl: endpoint,
                headers: { Authorization: 'Bearer ${HRONAUT_MCP_TOKEN}' },
                trust: false
              }
            }
          }, null, 2),
      ...(!authenticationDisabled && tokenEnvironmentSetup && { setupCommand: tokenEnvironmentSetup }),
      verifyCommand: 'qwen mcp list'
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
  <style>${HOME_PAGE_STYLES}</style>
</head>
<body>
  <main class="page">
    <header class="hero">
      <div class="hero-copy">
        <div class="brand"><span class="mark">H</span> ${escapeHtml(home.brand)}</div>
        <h1 id="home-view-title">${escapeHtml(home.connect.heading)}</h1>
        <p id="home-view-description" class="hero-description">${escapeHtml(home.connect.description)}</p>
      </div>
      <div class="hero-status" aria-live="polite">
        <span id="server-state" class="status-label"><span class="dot"></span> ${escapeHtml(home.status.online)}</span>
        <strong id="active-count" class="status-value">${escapeHtml(home.status.activeOther.replace('{count}', '0'))}</strong>
        <span id="request-count" class="status-detail">${escapeHtml(home.status.waiting)}</span>
      </div>
    </header>

    <nav class="home-navigation" role="tablist" aria-label="${escapeHtml(home.navigation.label)}">
      <button id="home-tab-connect" type="button" role="tab" data-home-view="connect" data-open-setup aria-selected="true" aria-controls="home-connect">${escapeHtml(home.navigation.connect)}</button>
      <button id="home-tab-overview" type="button" role="tab" data-home-view="overview" data-home-section="activity" aria-selected="false" aria-controls="home-overview" tabindex="-1">${escapeHtml(home.navigation.overview)}</button>
      <button id="home-tab-tools" type="button" role="tab" data-home-view="tools" data-home-section="tools" aria-selected="false" aria-controls="home-tools" tabindex="-1">${escapeHtml(home.navigation.tools)}</button>
    </nav>

    <section id="home-connect" class="home-view" role="tabpanel" aria-labelledby="home-tab-connect" tabindex="0">
      <div class="connect-layout">
        <section id="setup" class="panel setup-panel" aria-label="${escapeHtml(home.journey.setup)}">
          <header class="panel-heading"><h2 id="connect-title">${escapeHtml(home.connect.agentsLabel)}</h2><span class="count">${escapeHtml(home.connect.clients.replace('{count}', new Intl.NumberFormat(options.locale).format(guides.length)))}</span></header>
        <div class="agent-layout">
          <div class="guide-picker">
            <label class="search-field"><span>${escapeHtml(home.journey.searchAgents)}</span><input id="agent-search" type="search" autocomplete="off" aria-controls="agent-list"></label>
            <nav id="agent-list" class="agents" aria-label="${escapeHtml(home.connect.agentsLabel)}"></nav>
            <p id="agent-empty" class="filter-empty" role="status" hidden>${escapeHtml(home.journey.noAgents)}</p>
          </div>
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
            <div class="guide-doc-action">
              <button type="button" data-agent-guide aria-describedby="guide-open-status"></button>
              <span id="guide-open-status" class="action-status" role="status" aria-live="polite"></span>
            </div>
            ${options.authenticationDisabled ? `<div id="guide-primary-action" class="guide-primary-action" hidden>
              <button type="button" data-vscode-install>${escapeHtml(home.connect.openVsCode)}</button>
              <span id="guide-primary-status" class="guide-primary-status" aria-live="polite"></span>
            </div>` : ''}
            <p class="security">${escapeHtml(securityNote)}</p>
          </div>
        </div>
        </section>
        <aside class="connect-aside">
          <section class="connection-check">
            <span class="section-kicker">${escapeHtml(home.journey.verify)}</span>
            <h2>${escapeHtml(home.connect.verify)}</h2>
            <p id="connection-note" class="connection-note" role="status">${escapeHtml(home.journey.waiting)}</p>
            <button type="button" class="text-action" data-open-view="overview">${escapeHtml(home.navigation.overview)} <span aria-hidden="true">→</span></button>
          </section>
    <section class="panel first-run" aria-labelledby="first-run-title">
      <div>
        <span class="first-run-kicker">${escapeHtml(home.journey.tryTask)}</span>
        <h2 id="first-run-title">${escapeHtml(home.firstRun.heading)}</h2>
        <p>${escapeHtml(home.firstRun.description)}</p>
      </div>
      <div class="code-wrap">
        <pre><code id="first-run-prompt">${escapeHtml(home.firstRun.prompt)}</code></pre>
        <button class="copy-button code-copy" type="button" data-copy-target="first-run-prompt">${escapeHtml(home.firstRun.copy)}</button>
      </div>
    </section>        </aside>
      </div>
    </section>

    <section id="home-overview" class="home-view" role="tabpanel" aria-labelledby="home-tab-overview" tabindex="0" hidden>
      <div class="impact-grid">
        <div class="impact"><strong id="completed-count">0</strong><span>${escapeHtml(home.activity.tabActionsCompleted)}</span></div>
        <div class="impact"><strong id="tool-types-count">0</strong><span>${escapeHtml(home.activity.toolsUsed)}</span></div>
        <div class="impact"><strong id="success-rate">—</strong><span>${escapeHtml(home.activity.successfulActions)}</span></div>
      </div>
      <div class="overview-layout">
    <section id="activity" class="panel activity" aria-labelledby="activity-title" tabindex="-1">
      <header class="panel-heading">
        <div><h2 id="activity-title">${escapeHtml(home.activity.heading)}</h2><p>${escapeHtml(home.activity.description)}</p></div>
        <span id="activity-count" class="count">${escapeHtml(home.counts.actionsOther.replace('{count}', '0'))}</span>
      </header>
      <div class="activity-layout">
        <div class="activity-column">
          <h3>${escapeHtml(home.activity.recent)}</h3>
          <div id="activity-list" class="activity-list"></div>
          <p class="privacy-note">${escapeHtml(home.activity.privacy)}</p>
        </div>

      </div>
    </section>      <section class="panel" aria-labelledby="connections-title">
        <header class="panel-heading">
          <div><h2 id="connections-title">${escapeHtml(home.connections.heading)}</h2><p>${escapeHtml(home.connections.description)}</p></div>
          <span id="client-count" class="count">${escapeHtml(home.counts.clientsOther.replace('{count}', '0'))}</span>
        </header>
        <div id="connections" class="connections-body"></div>
      </section>      </div>
    </section>

    <section id="home-tools" class="home-view" role="tabpanel" aria-labelledby="home-tab-tools" tabindex="0" hidden>
    <section id="tools" class="panel tools" tabindex="-1" aria-labelledby="tools-title">
      <header class="panel-heading"><h2 id="tools-title">${escapeHtml(home.navigation.tools)}</h2><span id="tool-count" class="count">${escapeHtml(home.counts.tools.replace('{count}', '0'))}</span></header>
      <p class="connection-note">${escapeHtml(home.tools.description)}</p>
      <label class="search-field"><span>${escapeHtml(home.journey.searchTools)}</span><input id="tool-search" type="search" autocomplete="off" aria-controls="tool-grid"></label>
      <p id="tool-empty" class="filter-empty" role="status" hidden>${escapeHtml(home.journey.noTools)}</p>
      <div id="tool-grid" class="tool-grid"></div>
    </section>    </section>

    <div class="home-bottom">
      <div class="endpoint">
        <span class="endpoint-label">${escapeHtml(home.endpoint)}</span>
        <code id="endpoint">${endpoint}</code>
        <button class="copy-button" type="button" data-copy-target="endpoint">${escapeHtml(home.copyUrl)}</button>
      </div>
      <details class="support-panel">
        <summary>${escapeHtml(home.support.troubleshoot)}</summary>
        <aside class="support-card">
          <span id="support-kicker">${escapeHtml(home.support.kicker)}</span>
          <h3 id="support-heading">${escapeHtml(home.support.heading)}</h3>
          <p id="support-message">${escapeHtml(home.support.message)}</p>
          <button id="support-troubleshoot" type="button" data-setup-help aria-describedby="support-help-status">${escapeHtml(home.support.troubleshoot)}</button>
          <div id="support-help-status" class="action-status" role="status" aria-live="polite"></div>
          <button id="support-feedback" class="secondary" type="button" data-setup-feedback aria-describedby="support-feedback-status">${escapeHtml(home.support.reportTrouble)}</button>
          <div id="support-feedback-status" class="action-status" role="status" aria-live="polite"></div>
          <button id="support-recommend" class="secondary" type="button" data-copy-target="support-recommend-message" hidden>${escapeHtml(home.support.recommend)}</button>
          <span id="support-recommend-message" hidden>${escapeHtml(home.support.recommendMessage)}</span>
          <small id="support-welcome">${escapeHtml(home.support.helpPrivacy)}</small>
          <small id="support-feedback-privacy">${escapeHtml(home.support.feedbackPrivacy)}</small>
          <small id="support-recommend-privacy" hidden>${escapeHtml(home.support.recommendPrivacy)}</small>
        </aside>      </details>
    </div>
    <footer class="footer"><span>${escapeHtml(home.footer)}</span><span id="server-version">Hronaut ${escapeHtml(options.initialState.version)}</span></footer>
  </main>
  <script>
    const guides = ${serialized(guides)};
    const messages = ${serialized(home)};
    const locale = ${serialized(options.locale)};
    let dashboard = ${serialized(options.initialState)};
    const renderedPresentationRevision = dashboard.presentationRevision;
    let selectedGuide = guides[0].id;
    try {
      const remembered = window.localStorage.getItem('hronaut.home.guide');
      if (guides.some((guide) => guide.id === remembered)) selectedGuide = remembered;
    } catch { /* Setup remains usable when profile storage is unavailable. */ }
    const copyButtonStates = new WeakMap();
    let agentGuideSequence = 0;
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
      return node.innerHTML.replaceAll('"', '&quot;');
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
          try { window.localStorage.setItem('hronaut.home.guide', selectedGuide); } catch { /* Optional preference. */ }
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
      agentGuideSequence += 1;
      const agentGuideButton = document.querySelector('[data-agent-guide]');
      agentGuideButton.disabled = false;
      agentGuideButton.title = '';
      document.getElementById('guide-open-status').textContent = '';
      agentGuideButton.textContent = interpolate(messages.connect.openGuide, { name: guide.name });
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

    const agentGuideButton = document.querySelector('[data-agent-guide]');
    agentGuideButton.addEventListener('click', async () => {
      if (agentGuideButton.disabled) return;
      const requestedGuide = selectedGuide;
      const sequence = ++agentGuideSequence;
      agentGuideButton.disabled = true;
      agentGuideButton.title = '';
      document.getElementById('guide-open-status').textContent = '';
      agentGuideButton.textContent = interpolate(messages.connect.openGuide, { name: guides.find((guide) => guide.id === requestedGuide).name });
      try {
        if (!window.hronautHome?.openAgentGuide) throw new Error(messages.connect.guideUnavailable);
        await window.hronautHome.openAgentGuide(requestedGuide);
      } catch (error) {
        if (sequence !== agentGuideSequence || selectedGuide !== requestedGuide) return;
        agentGuideButton.title = error instanceof Error ? error.message : messages.connect.guideUnavailable;
        document.getElementById('guide-open-status').textContent = agentGuideButton.title;
        agentGuideButton.textContent = messages.journey.retry + ' · ' + interpolate(messages.connect.openGuide, { name: guides.find((guide) => guide.id === requestedGuide).name });
      } finally {
        if (sequence === agentGuideSequence) agentGuideButton.disabled = false;
      }
    });

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

    const setupFeedbackButton = document.querySelector('[data-setup-feedback]');
    if (setupFeedbackButton) {
      setupFeedbackButton.addEventListener('click', async () => {
        if (setupFeedbackButton.disabled) return;
        setupFeedbackButton.disabled = true;
        setupFeedbackButton.title = '';
        document.getElementById('support-feedback-status').textContent = '';
        setupFeedbackButton.textContent = (dashboard.completedToolCalls || 0) > (dashboard.toolMetrics || []).reduce((total, metric) => total + metric.failures, 0) ? messages.support.feedback : messages.support.reportTrouble;
        try {
          if (!window.hronautHome?.openSetupFeedback) throw new Error(messages.support.feedbackUnavailable);
          await window.hronautHome.openSetupFeedback();
        } catch (error) {
          setupFeedbackButton.title = error instanceof Error ? error.message : messages.support.feedbackUnavailable;
          document.getElementById('support-feedback-status').textContent = setupFeedbackButton.title;
          setupFeedbackButton.textContent = messages.journey.retry + ' · ' + setupFeedbackButton.textContent;
        } finally {
          setupFeedbackButton.disabled = false;
        }
      });
    }

    const setupHelpButton = document.querySelector('[data-setup-help]');
    if (setupHelpButton) {
      setupHelpButton.addEventListener('click', async () => {
        if (setupHelpButton.disabled) return;
        setupHelpButton.disabled = true;
        setupHelpButton.title = '';
        document.getElementById('support-help-status').textContent = '';
        setupHelpButton.textContent = messages.support.troubleshoot;
        try {
          if (!window.hronautHome?.openSetupHelp) throw new Error(messages.support.troubleshootUnavailable);
          await window.hronautHome.openSetupHelp();
        } catch (error) {
          setupHelpButton.title = error instanceof Error ? error.message : messages.support.troubleshootUnavailable;
          document.getElementById('support-help-status').textContent = setupHelpButton.title;
          setupHelpButton.hidden = false;
          setupHelpButton.textContent = messages.journey.retry + ' · ' + setupHelpButton.textContent;
        } finally {
          setupHelpButton.disabled = false;
        }
      });
    }

    function renderDashboard() {
      document.documentElement.dataset.theme = dashboard.theme === 'cyberpunk-turbo' ? 'cyberpunk-turbo' : '';
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
      const successful = Math.max(0, completed - failures);
      const successRate = completed ? new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(successful / completed) : '—';
      document.getElementById('activity-count').textContent = countMessage(messages.counts.actionsOne, messages.counts.actionsOther, completed);
      document.getElementById('completed-count').textContent = new Intl.NumberFormat(locale).format(completed);
      document.getElementById('tool-types-count').textContent = new Intl.NumberFormat(locale).format((dashboard.toolMetrics || []).length);
      document.getElementById('success-rate').textContent = successRate;
      const supportKicker = document.getElementById('support-kicker');
      supportKicker.textContent = successful > 0 ? messages.support.activeKicker : messages.support.kicker;
      document.getElementById('support-heading').textContent = successful
        ? countMessage(messages.support.activeHeadingOne, messages.support.activeHeadingOther, successful)
        : completed ? messages.support.failedHeading : messages.support.heading;
      document.getElementById('support-message').textContent = successful
        ? messages.support.activeMessage
        : completed ? messages.support.failedMessage : messages.support.message;
      const supportTroubleshoot = document.getElementById('support-troubleshoot');
      const supportFeedback = document.getElementById('support-feedback');
      const supportRecommend = document.getElementById('support-recommend');
      const supportWelcome = document.getElementById('support-welcome');
      const supportFeedbackPrivacy = document.getElementById('support-feedback-privacy');
      const supportRecommendPrivacy = document.getElementById('support-recommend-privacy');
      supportTroubleshoot.hidden = successful > 0 && document.activeElement !== supportTroubleshoot && !document.getElementById('support-help-status').textContent;
      supportFeedback.hidden = false;
      if (!document.getElementById('support-feedback-status').textContent) {
        supportFeedback.textContent = successful > 0 ? messages.support.feedback : messages.support.reportTrouble;
      }
      supportRecommend.hidden = successful === 0;
      supportWelcome.hidden = successful > 0;
      supportFeedbackPrivacy.hidden = false;
      supportRecommendPrivacy.hidden = successful === 0;

      const activityList = document.getElementById('activity-list');
      if (!dashboard.recentActivity?.length) {
        activityList.innerHTML = '<div class="empty"><div><strong>' + escapeText(messages.activity.emptyHeading) + '</strong><span>' + escapeText(messages.activity.emptyDescription) + '</span></div></div>';
      } else {
        activityList.innerHTML = dashboard.recentActivity.slice(0, 8).map((activity) =>
          (() => {
            const outcome = activity.result?.outcome || (activity.outcome === 'failed' ? 'failed' : 'succeeded');
            const labels = { succeeded: messages.activity.done, failed: messages.activity.failed, cancelled: messages.activity.cancelled,
              blocked: messages.activity.blocked, 'timed-out': messages.activity.timedOut, interrupted: messages.activity.interrupted,
              'outcome-unknown': messages.activity.unknown };
            const tone = outcome === 'succeeded' ? '' : outcome === 'failed' ? 'failed' : 'attention';
            return '<div class="activity-item"><div><code>' + escapeText(activity.toolName) + '</code><div class="activity-meta">' + escapeText(relativeTime(activity.completedAt)) + ' · ' + escapeText(duration(activity.durationMs)) + '</div></div><span class="outcome ' + tone + '">' + escapeText(labels[outcome] || messages.activity.failed) + '</span></div>';
          })()
        ).join('');
      }

      document.getElementById('connection-note').textContent = dashboard.clients.length ? messages.journey.observed : messages.journey.waiting;
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

      renderTools();
    }

    let renderedToolCatalog = '';
    function renderTools() {
      const query = document.getElementById('tool-search').value.trim().toLocaleLowerCase(locale);
      const tools = dashboard.tools.filter((tool) => (tool.name + ' ' + tool.category + ' ' + tool.description).toLocaleLowerCase(locale).includes(query));
      document.getElementById('tool-empty').hidden = !query || tools.length > 0;
      // Status polling must not replace a focused or expanded reference entry.
      const catalog = JSON.stringify(tools);
      if (catalog === renderedToolCatalog) return;
      renderedToolCatalog = catalog;
      const expanded = new Set(Array.from(document.querySelectorAll('#tool-grid details[open]')).map((entry) => entry.dataset.tool));
      document.getElementById('tool-grid').innerHTML = tools.map((tool) =>
        '<details class="tool" data-tool="' + escapeText(tool.name) + '"' + (expanded.has(tool.name) ? ' open' : '') + '><summary><span class="tool-top"><code>' + escapeText(tool.name) + '</code><span class="category">' + escapeText(tool.category) + '</span></span></summary><p>' + escapeText(tool.description) + '</p></details>'
      ).join('');
    }

    let dashboardRefreshSequence = 0;

    async function refreshDashboard() {
      const sequence = ++dashboardRefreshSequence;
      try {
        const response = await fetch('/api/status', { cache: 'no-store' });
        if (!response.ok) throw new Error('Local status unavailable');
        const nextDashboard = await response.json();
        if (sequence !== dashboardRefreshSequence) return;
        if (
          !nextDashboard || typeof nextDashboard !== 'object'
          || typeof nextDashboard.version !== 'string'
          || !Number.isFinite(nextDashboard.activeRequests)
          || !Number.isFinite(nextDashboard.totalRequests)
          || typeof nextDashboard.paused !== 'boolean'
          || !Array.isArray(nextDashboard.clients) || !Array.isArray(nextDashboard.tools)
          || (nextDashboard.recentActivity !== undefined && !Array.isArray(nextDashboard.recentActivity))
          || (nextDashboard.toolMetrics !== undefined && !Array.isArray(nextDashboard.toolMetrics))
        ) throw new Error('Invalid local status response');
        if (nextDashboard.presentationRevision !== renderedPresentationRevision) {
          window.location.reload();
          return;
        }
        dashboard = nextDashboard;
        renderDashboard();
      } catch {
        if (sequence !== dashboardRefreshSequence) return;
        const serverState = document.getElementById('server-state');
        serverState.innerHTML = '<span class="dot error"></span> ' + escapeText(messages.status.unavailable);
        serverState.title = '';
        document.getElementById('active-count').textContent = messages.status.unavailable;
        document.getElementById('request-count').textContent = messages.status.reconnecting;
        document.getElementById('connection-note').textContent = messages.journey.unavailable;
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

    const homeViews = ['connect', 'overview', 'tools'];
    let selectedHomeView = (dashboard.clients.length || dashboard.completedToolCalls) ? 'overview' : 'connect';
    try {
      const rememberedView = window.localStorage.getItem('hronaut.home.view');
      if (homeViews.includes(rememberedView)) selectedHomeView = rememberedView;
    } catch { /* Home remains usable without preference storage. */ }

    function revealSelectedGuide() {
      const selected = document.querySelector('[data-guide="' + selectedGuide + '"]');
      const list = document.getElementById('agent-list');
      if (selectedHomeView === 'connect' && selected && !selected.hidden) list.scrollTop += selected.getBoundingClientRect().top - list.getBoundingClientRect().top;
    }

    function selectHomeView(view, focus = false) {
      if (!homeViews.includes(view)) return;
      selectedHomeView = view;
      document.querySelectorAll('[data-home-view]').forEach(button => {
        const selected = button.dataset.homeView === view;
        button.setAttribute('aria-selected', String(selected));
        button.tabIndex = selected ? 0 : -1;
      });
      homeViews.forEach(id => { document.getElementById('home-' + id).hidden = id !== view; });
      document.getElementById('home-view-title').textContent = view === 'connect' ? messages.connect.heading : view === 'overview' ? messages.activity.heading : messages.navigation.tools;
      document.getElementById('home-view-description').textContent = view === 'connect' ? messages.connect.description : view === 'overview' ? messages.activity.description : messages.tools.description;
      if (focus) document.getElementById('home-tab-' + view).focus();
      try { window.localStorage.setItem('hronaut.home.view', view); } catch { /* Optional local preference. */ }
      revealSelectedGuide();
    }
    document.querySelectorAll('[data-home-view]').forEach(button => {
      button.addEventListener('click', () => selectHomeView(button.dataset.homeView));
      button.addEventListener('keydown', event => {
        if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
        const index = homeViews.indexOf(button.dataset.homeView);
        const next = event.key === 'ArrowRight' ? (index + 1) % homeViews.length
          : event.key === 'ArrowLeft' ? (index + homeViews.length - 1) % homeViews.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? homeViews.length - 1 : -1;
        if (next < 0) return;
        event.preventDefault();
        selectHomeView(homeViews[next], true);
      });
    });
    document.querySelectorAll('[data-open-view]').forEach(button => button.addEventListener('click', () => selectHomeView(button.dataset.openView, true)));
    selectHomeView(selectedHomeView);
    document.getElementById('agent-search').addEventListener('input', (event) => {
      const query = event.target.value.trim().toLocaleLowerCase(locale);
      let visible = 0;
      document.querySelectorAll('[data-guide]').forEach((button) => {
        button.hidden = !button.textContent.toLocaleLowerCase(locale).includes(query);
        if (!button.hidden) visible += 1;
      });
      document.getElementById('agent-empty').hidden = visible > 0;
    });
    document.getElementById('tool-search').addEventListener('input', renderTools);
    renderGuide();
    revealSelectedGuide();
    renderDashboard();
    pollDashboard();
  </script>
</body>
</html>`
}

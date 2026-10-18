import { describe, expect, it } from 'vitest'
import { agentDisplayName, agentStatus, bridgedAgentName, agentStatusText, agentStatusTone, strongerAgentState } from '../src/shared/agent-status.js'
import { localeMessages } from '../src/shared/i18n.js'

describe('agent status', () => {
  it('names MCP clients as people know them', () => {
    expect(agentDisplayName('claude-code')).toBe('Claude Code')
    expect(agentDisplayName('codex-mcp-client')).toBe('Codex')
    expect(agentDisplayName('CURSOR-VSCODE')).toBe('Cursor')
    // Other names stay as sent, so a generic one never turns into something it is not.
    expect(agentDisplayName('mcp-client')).toBe('mcp-client')
    expect(agentDisplayName('kiro-cli')).toBe('kiro-cli')
    expect(agentDisplayName('Visual Studio Code')).toBe('Visual Studio Code')
    expect(agentDisplayName('  Zed ')).toBe('Zed')
  })

  it('names a known client that came through a bridge as the product and keeps the bridge', () => {
    // mcp-remote reports the client's own name with "(via mcp-remote <version>)" appended.
    expect(agentDisplayName('claude-ai (via mcp-remote 0.1.37)')).toBe('Claude (via mcp-remote 0.1.37)')
    expect(agentDisplayName('codex-mcp-client(via  mcp-remote 0.1.37 )')).toBe('Codex (via mcp-remote 0.1.37)')
    expect(agentDisplayName('local-agent (via mcp-remote 0.1.37)')).toBe('local-agent (via mcp-remote 0.1.37)')
    // Naming it again changes nothing, and a name that only looks bridged stays as sent.
    expect(agentDisplayName('Claude (via mcp-remote 0.1.37)')).toBe('Claude (via mcp-remote 0.1.37)')
    for (const name of ['claude-ai (via  )', '(via mcp-remote)', 'claude-ai (via (mcp-remote))', 'claude-ai (Via mcp-remote)', 'claude-ai (via mcp-remote']) {
      expect(agentDisplayName(name), name).toBe(name)
    }
    expect(bridgedAgentName(' claude-ai (via mcp-remote 0.1.37) ')).toEqual({ client: 'claude-ai', via: 'mcp-remote 0.1.37' })
    expect(bridgedAgentName(' Claude Code ')).toEqual({ client: 'Claude Code' })
  })

  it('names a bridged agent in the status line without its bridge', () => {
    const en = localeMessages['en-US'].agentStatus
    const bridged = { key: 'a', name: 'Claude (via mcp-remote 0.1.37)', state: 'working' as const }
    expect(agentStatus('ready', [bridged])).toEqual({ kind: 'working', message: 'working', name: 'Claude', count: 1 })
    expect(agentStatusText(agentStatus('ready', [{ ...bridged, state: 'idle' }]), en, 'en-US')).toBe('Claude connected')
    expect(agentStatus('ready', [bridged, { key: 'b', name: 'Codex', state: 'idle' }]).name).toBe('Claude')
  })

  it('never reads a client name as a pattern or a placeholder, and counts a blank name instead of showing it', () => {
    const en = localeMessages['en-US'].agentStatus
    expect(agentStatusText(agentStatus('ready', [{ key: 'a', name: "$' x", state: 'idle' }]), en, 'en-US')).toBe("$' x connected")
    expect(agentStatusText(agentStatus('ready', [{ key: 'a', name: '{count} bot', state: 'working' }]), en, 'en-US')).toBe('{count} bot is working')
    expect(agentStatus('ready', [{ key: 'a', name: ' ', state: 'idle' }])).toEqual({ kind: 'connected', message: 'connectedMany', count: 1 })
    expect(agentStatusText(agentStatus('ready', [{ key: 'a', name: '', state: 'working' }]), en, 'en-US')).toBe('1 agent working')
  })

  it('puts the server first, then needs you, working and connected', () => {
    const claude = { key: 'a', name: 'Claude Code', state: 'idle' as const }
    expect(agentStatus('error', [claude]).kind).toBe('error')
    expect(agentStatus('paused', [claude]).kind).toBe('paused')
    expect(agentStatus('ready', [])).toEqual({ kind: 'ready', message: 'ready', count: 0 })
    expect(agentStatus('ready', [claude])).toEqual({ kind: 'connected', message: 'connected', name: 'Claude Code', count: 1 })
    expect(agentStatus('ready', [claude, { key: 'b', name: 'Codex', state: 'working' }])).toEqual({ kind: 'working', message: 'working', name: 'Codex', count: 1 })
    expect(agentStatus('ready', [claude, { key: 'b', name: 'Codex', state: 'needs-you' }]).kind).toBe('needs-you')
  })

  it('keeps the state that matters more to the person', () => {
    expect(strongerAgentState(undefined, 'idle')).toBe('idle')
    expect(strongerAgentState('working', 'idle')).toBe('working')
    expect(strongerAgentState('working', 'needs-you')).toBe('needs-you')
    expect(strongerAgentState('needs-you', 'working')).toBe('needs-you')
  })

  it('counts an agent seen in several workspaces once, by its strongest state', () => {
    const status = agentStatus('ready', [
      { key: 'a', name: 'Claude Code', state: 'idle' },
      { key: 'a', name: 'Claude Code', state: 'working' },
      { key: 'b', name: 'Codex', state: 'idle' }
    ])
    expect(status).toEqual({ kind: 'working', message: 'working', name: 'Claude Code', count: 1 })
  })

  it('says it in the locale in use with its plural form', () => {
    const many = agentStatus('ready', ['a', 'b', 'c', 'd', 'e'].map((key) => ({ key, name: key, state: 'idle' as const })))
    expect(agentStatusText(many, localeMessages['en-US'].agentStatus, 'en-US')).toBe('5 agents connected')
    expect(agentStatusText(many, localeMessages['ru-RU'].agentStatus, 'ru-RU')).toBe('5 агентов подключено')
    expect(agentStatusText(agentStatus('ready', []), localeMessages['en-US'].agentStatus, 'en-US')).toBe('Ready for agents')
    expect(agentStatusTone('needs-you')).toBe('needs-you')
    expect(agentStatusTone('connected')).toBe('ready')
  })
})

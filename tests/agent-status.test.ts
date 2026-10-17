import { describe, expect, it } from 'vitest'
import { agentDisplayName, agentStatus, agentStatusText, agentStatusTone, strongerAgentState } from '../src/shared/agent-status.js'
import { localeMessages } from '../src/shared/i18n.js'

describe('agent status', () => {
  it('names MCP clients as people know them', () => {
    expect(agentDisplayName('claude-code')).toBe('Claude Code')
    expect(agentDisplayName('codex-mcp-client')).toBe('Codex')
    expect(agentDisplayName('my-review-bot-client')).toBe('My Review Bot')
    expect(agentDisplayName('Visual Studio Code')).toBe('Visual Studio Code')
    expect(agentDisplayName('  Zed ')).toBe('Zed')
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
    expect(agentStatusTone('needs-you')).toBe('paused')
  })
})

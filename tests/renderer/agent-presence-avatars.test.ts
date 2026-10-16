import { render, screen, within } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import AgentPresenceAvatars from '../../src/renderer/src/components/AgentPresenceAvatars.vue'
import { useAgentPresence } from '../../src/renderer/src/composables/useAgentPresence.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { AgentPresence, AgentPresenceSnapshot, HronautAgentPresenceApi } from '../../src/shared/agent-presence.js'
import { AGENT_STEP_KINDS } from '../../src/shared/agent-steps.js'
import { SUPPORTED_LOCALES } from '../../src/shared/locale.js'

function agent(name: string, overrides: Partial<AgentPresence> = {}): AgentPresence {
  return { clientKey: `key-${name}`, name, initial: name.slice(0, 1).toUpperCase(), colorIndex: 1, state: 'working', step: 'click', lastTabId: 'tab-2', ...overrides }
}

function fakeApi(initial: Promise<AgentPresenceSnapshot>) {
  let listener!: (snapshot: AgentPresenceSnapshot) => void
  const unsubscribe = vi.fn()
  const api: HronautAgentPresenceApi = { get: vi.fn(() => initial), onChanged: (next) => { listener = next; return unsubscribe } }
  return { api, unsubscribe, change: (snapshot: AgentPresenceSnapshot) => listener(snapshot) }
}

function renderAvatars(agents: AgentPresence[], props: Record<string, unknown> = {}) {
  const { api, unsubscribe, change } = fakeApi(Promise.resolve({ revision: 1, workspaces: { 'workspace-a': agents } }))
  const view = render(AgentPresenceAvatars, {
    global: { plugins: [createHronautI18n('en-US')] },
    props: { workspaceId: 'workspace-a', activeTabId: 'tab-1', api, ...props }
  })
  return { view, unsubscribe, change }
}

describe('agent avatars in the toolbar', () => {
  it('shows each agent in the workspace with its name, state and current step', async () => {
    renderAvatars([
      agent('Windsurf', { state: 'needs-you', step: 'askYou', attentionTabId: 'tab-3' }),
      agent('Claude Code', { step: 'navigate' }),
      agent('Cursor', { state: 'idle' })
    ], { attentionReason: 'Approve the order.' })
    const group = await screen.findByRole('group', { name: 'Agents in this workspace' })
    const buttons = within(group).getAllByRole('button')
    expect(buttons.map((button) => [button.getAttribute('aria-label'), button.dataset.state, button.dataset.tooltip])).toEqual([
      ['Windsurf, needs you', 'needs-you', 'Windsurf · Needs you: Approve the order.'],
      ['Claude Code, working', 'working', 'Claude Code · Opening a page'],
      ['Cursor, idle', 'idle', 'Cursor · Idle']
    ])
    expect(buttons[0]!.querySelector('.agent-avatar-badge')).not.toBeNull()
    expect(buttons[1]!.querySelector('.agent-avatar-badge')).toBeNull()
    expect(buttons[1]!.textContent?.trim()).toBe('C')
  })

  it('shows three avatars, then the rest as +N with their names', async () => {
    renderAvatars(['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'].map((name) => agent(name)))
    const group = await screen.findByRole('group', { name: 'Agents in this workspace' })
    expect(within(group).getAllByRole('button')).toHaveLength(3)
    const more = within(group).getByRole('img', { name: 'More agents: Delta, Echo' })
    expect(more.textContent).toBe('+2')
  })

  it('renders a client name as text, and a nameless client as Agent with a robot', async () => {
    renderAvatars([agent('<img src=x onerror=alert(1)>', { initial: '' }), agent('', { initial: '', clientKey: 'key-empty' })])
    const group = await screen.findByRole('group', { name: 'Agents in this workspace' })
    const [html, nameless] = within(group).getAllByRole('button')
    expect(html!.getAttribute('aria-label')).toBe('<img src=x onerror=alert(1)>, working')
    expect(group.querySelector('img')).toBeNull()
    expect(nameless!.getAttribute('aria-label')).toBe('Agent, working')
    expect(nameless!.querySelector('svg')).not.toBeNull()
  })

  it('shows the tab an agent asked about or last used, unless it is already in view', async () => {
    const { view } = renderAvatars([
      agent('Windsurf', { state: 'needs-you', attentionTabId: 'tab-3', lastTabId: 'tab-2' }),
      agent('Claude Code', { lastTabId: 'tab-2' }),
      agent('Cursor', { lastTabId: 'tab-1' }),
      agent('Zed', { lastTabId: undefined })
    ])
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Windsurf, needs you' }))
    await user.click(screen.getByRole('button', { name: 'Claude Code, working' }))
    await user.click(screen.getByRole('button', { name: 'Cursor, working' }))
    expect(view.emitted('select')).toEqual([['tab-3'], ['tab-2']])
  })

  it('shows nothing without agents or outside a workspace', async () => {
    const { view } = renderAvatars([agent('Claude Code')], { workspaceId: undefined })
    await nextTick()
    expect(view.container.querySelector('[data-testid="agent-presence"]')).toBeNull()
    await view.rerender({ workspaceId: 'workspace-b' })
    expect(view.container.querySelector('[data-testid="agent-presence"]')).toBeNull()
    await view.rerender({ workspaceId: 'workspace-a' })
    expect(await screen.findByRole('group', { name: 'Agents in this workspace' })).toBeTruthy()
  })

  it('follows changes and stops listening when removed', async () => {
    const { view, change, unsubscribe } = renderAvatars([agent('Claude Code')])
    await screen.findByRole('button', { name: 'Claude Code, working' })
    change({ revision: 2, workspaces: { 'workspace-a': [agent('Claude Code', { state: 'idle' })] } })
    expect(await screen.findByRole('button', { name: 'Claude Code, idle' })).toBeTruthy()
    change({ revision: 3, workspaces: {} })
    await nextTick()
    expect(view.container.querySelector('[data-testid="agent-presence"]')).toBeNull()
    view.unmount()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})

describe('agent presence mirror', () => {
  it('keeps a change that arrives before the first read, and ignores older revisions', async () => {
    let resolve!: (snapshot: AgentPresenceSnapshot) => void
    const { api, change } = fakeApi(new Promise((done) => { resolve = done }))
    const presence = useAgentPresence(api)
    change({ revision: 5, workspaces: { 'workspace-a': [agent('Claude Code')] } })
    resolve({ revision: 4, workspaces: {} })
    await Promise.resolve()
    await Promise.resolve()
    expect(presence.snapshot.value.revision).toBe(5)
    change({ revision: 3, workspaces: {} })
    expect(presence.snapshot.value.workspaces['workspace-a']).toHaveLength(1)
    presence.dispose()
    change({ revision: 6, workspaces: {} })
    expect(presence.snapshot.value.revision).toBe(5)
  })
})

describe('agent step words', () => {
  it('has a phrase for every step and state in every language', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const { t, te } = createHronautI18n(locale).global
      for (const key of [...AGENT_STEP_KINDS.map((kind) => `shell.agents.steps.${kind}`), 'shell.agents.states.idle', 'shell.agents.states.working', 'shell.agents.states.needsYou', 'shell.agents.group', 'shell.agents.more', 'shell.agents.needsYouReason']) {
        expect(te(key, locale), `${locale} ${key}`).toBe(true)
        expect(t(key, { name: 'N', state: 'S', step: 'P', reason: 'R', names: 'A, B' }), `${locale} ${key}`).not.toBe(key)
      }
    }
  })
})

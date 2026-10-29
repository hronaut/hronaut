import { render, screen, within } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import AgentLiveStrip from '../../src/renderer/src/features/agents/AgentLiveStrip.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { AgentPresence, AgentPresenceSnapshot, HronautAgentPresenceApi } from '../../src/shared/agent-presence.js'
import { SUPPORTED_LOCALES } from '../../src/shared/locale.js'

function agent(name: string, overrides: Partial<AgentPresence> = {}): AgentPresence {
  return { clientKey: `key-${name}`, name, initial: name.slice(0, 1).toUpperCase(), colorIndex: 1, state: 'working', step: 'navigate', recentSteps: [], lastTabId: 'tab-2', ...overrides }
}

function fakeApi(agents: AgentPresence[], first?: Promise<AgentPresenceSnapshot>) {
  let listener!: (snapshot: AgentPresenceSnapshot) => void
  const unsubscribe = vi.fn()
  const api: HronautAgentPresenceApi = {
    get: vi.fn(() => first ?? Promise.resolve({ revision: 1, workspaces: { 'workspace-a': agents } })),
    onChanged: (next) => { listener = next; return unsubscribe }
  }
  return { api, unsubscribe, change: (snapshot: AgentPresenceSnapshot) => listener(snapshot) }
}

const TABS = [{ id: 'tab-1' }, { id: 'tab-2' }, { id: 'tab-3' }]

function renderStrip(agents: AgentPresence[], props: Record<string, unknown> = {}, first?: Promise<AgentPresenceSnapshot>) {
  const fake = fakeApi(agents, first)
  const view = render(AgentLiveStrip, {
    global: { plugins: [createHronautI18n('en-US')] },
    props: { workspaceId: 'workspace-a', tabs: TABS, api: fake.api, ...props }
  })
  return { view, ...fake }
}

async function strip(): Promise<HTMLElement> {
  return screen.findByRole('group', { name: 'Live status of agents in this workspace' })
}

describe('pinned live strip', () => {
  it('shows what the agent is doing, with Pause and Take over for its tab', async () => {
    const { view } = renderStrip([agent('Claude Code', { step: 'click', target: 'Review order' })])
    const group = await strip()
    await within(group).findByText('Claude Code')
    expect(group.dataset.state).toBe('working')
    expect(within(group).getByText('Working')).toBeInTheDocument()
    const detail = within(group).getByText('Clicking “Review order”')
    // Cut to fit, so the whole step is in its tooltip.
    expect(detail.dataset.tooltip).toBe('Clicking “Review order”')
    const user = userEvent.setup()
    await user.click(within(group).getByRole('button', { name: 'Pause' }))
    await user.click(within(group).getByRole('button', { name: 'Take over' }))
    expect(view.emitted('setPaused')).toEqual([['tab-2', true]])
    expect(view.emitted('takeOver')).toEqual([['tab-2']])
    expect(within(group).queryByRole('button', { name: 'Hand back' })).toBeNull()
  })

  it('resumes a paused tab and offers nothing while agent control is locked', async () => {
    const tabs = [{ id: 'tab-2', agentPaused: true }]
    const { view } = renderStrip([agent('Claude Code')], { tabs })
    const group = await strip()
    const user = userEvent.setup()
    await user.click(await within(group).findByRole('button', { name: 'Resume' }))
    expect(view.emitted('setPaused')).toEqual([['tab-2', false]])

    await view.rerender({ agentControlLocked: true })
    const resume = within(group).getByRole('button', { name: 'Resume' })
    const takeOver = within(group).getByRole('button', { name: 'Take over' })
    expect(resume).toBeDisabled()
    expect(takeOver).toBeDisabled()
    await user.click(resume)
    await user.click(takeOver)
    expect(view.emitted('setPaused')).toHaveLength(1)
    expect(view.emitted('takeOver')).toBeUndefined()
  })

  it('shows the reason when the agent needs you and hands back from the strip', async () => {
    const { view } = renderStrip(
      [agent('Windsurf', { state: 'needs-you', step: 'askYou', attentionTabId: 'tab-3' })],
      { attentionReason: 'Log in to the bank.', attentionId: 'attention-1', attentionWorkspaceId: 'workspace-a', attentionTabId: 'tab-3' }
    )
    const group = await strip()
    await within(group).findByText('Log in to the bank.')
    expect(group.dataset.state).toBe('needs-you')
    expect(within(group).getByText('Needs you')).toBeInTheDocument()
    // Pausing an agent that waits for you does nothing, so only Take over stays.
    expect(within(group).queryByRole('button', { name: 'Pause' })).toBeNull()
    const user = userEvent.setup()
    await user.click(within(group).getByRole('button', { name: 'Hand back' }))
    await user.click(within(group).getByRole('button', { name: 'Take over' }))
    expect(view.emitted('handBack')).toEqual([['attention-1']])
    expect(view.emitted('takeOver')).toEqual([['tab-3']])
  })

  it('opens the agent card to answer a decision instead of handing it back', async () => {
    const { view } = renderStrip(
      [agent('Windsurf', { state: 'needs-you', step: 'askYou', attentionTabId: 'tab-3' })],
      { attentionReason: 'Human decision required: approve-action', attentionId: 'decision-1', attentionDecision: true, attentionWorkspaceId: 'workspace-a' }
    )
    const group = await strip()
    // The request's fixed English line stays out of the strip; it says so in your language.
    const detail = await within(group).findByText('Waiting for your decision')
    expect(detail.dataset.tooltip).toBe('Waiting for your decision')
    expect(group.textContent).not.toContain('Human decision required')
    await userEvent.setup().click(await within(group).findByRole('button', { name: 'Answer' }))
    expect(view.emitted('openCard')).toHaveLength(1)
    expect(within(group).queryByRole('button', { name: 'Hand back' })).toBeNull()
    expect(view.emitted('handBack')).toBeUndefined()
  })

  it('answers only a request about this workspace and the tab the agent asked about', async () => {
    const asking = agent('Windsurf', { state: 'needs-you', step: 'askYou', attentionTabId: 'tab-3' })
    const { view } = renderStrip([asking], { attentionReason: 'Approve the payout.', attentionId: 'attention-2', attentionWorkspaceId: 'workspace-b' })
    const group = await strip()
    await within(group).findByText('Asking for your help')
    expect(within(group).queryByText('Approve the payout.')).toBeNull()
    expect(within(group).queryByRole('button', { name: 'Hand back' })).toBeNull()
    // Same workspace, but about another tab: still not this agent's request.
    await view.rerender({ attentionWorkspaceId: 'workspace-a', attentionTabId: 'tab-1' })
    expect(within(group).queryByRole('button', { name: 'Hand back' })).toBeNull()
    await view.rerender({ attentionTabId: 'tab-3' })
    await within(group).findByText('Approve the payout.')
    expect(within(group).getByRole('button', { name: 'Hand back' })).toBeInTheDocument()
  })

  it('moves focus to the next control when Hand back leaves with focus on it', async () => {
    const { change } = renderStrip(
      [agent('Windsurf', { state: 'needs-you', step: 'askYou', attentionTabId: 'tab-3' })],
      { attentionReason: 'Log in.', attentionId: 'attention-1', attentionWorkspaceId: 'workspace-a' }
    )
    const group = await strip()
    const handBack = await within(group).findByRole('button', { name: 'Hand back' })
    handBack.focus()
    expect(document.activeElement).toBe(handBack)
    // Answered: the agent works again, so Hand back leaves and Pause comes back.
    change({ revision: 2, workspaces: { 'workspace-a': [agent('Windsurf', { attentionTabId: 'tab-3' })] } })
    await nextTick()
    await nextTick()
    expect(within(group).queryByRole('button', { name: 'Hand back' })).toBeNull()
    expect(document.activeElement).toBe(within(group).getByRole('button', { name: 'Pause' }))
  })

  it('keeps a held Enter from pressing a control again', async () => {
    const { change } = renderStrip(
      [agent('Windsurf', { state: 'needs-you', step: 'askYou', attentionTabId: 'tab-3' })],
      { attentionReason: 'Log in.', attentionId: 'attention-1', attentionWorkspaceId: 'workspace-a' }
    )
    const group = await strip()
    await within(group).findByRole('button', { name: 'Hand back' })
    const pressed: string[] = []
    const holdEnterOnEach = () => {
      for (const button of within(group).getAllByRole('button')) {
        const press = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
        const repeat = new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, cancelable: true })
        button.dispatchEvent(press)
        button.dispatchEvent(repeat)
        expect(press.defaultPrevented).toBe(false)
        if (!repeat.defaultPrevented) pressed.push(button.textContent || button.getAttribute('aria-label') || '')
      }
    }
    holdEnterOnEach()
    change({ revision: 2, workspaces: { 'workspace-a': [agent('Windsurf', { attentionTabId: 'tab-3' })] } })
    await within(group).findByRole('button', { name: 'Pause' })
    holdEnterOnEach()

    // Hand back hands its focus to Pause or Take over, so the repeats of a held Enter pressed it, and Pause flipped
    // on every repeat.
    expect(pressed).toEqual([])
  })

  it('holds its place without claiming no one works until main\'s presence arrives', async () => {
    let resolve!: (snapshot: AgentPresenceSnapshot) => void
    renderStrip([], {}, new Promise((done) => { resolve = done }))
    const group = await strip()
    expect(group.dataset.state).toBe('loading')
    expect(within(group).queryByText('No agent is working in this workspace')).toBeNull()
    expect(within(group).getByRole('button', { name: 'Unpin live status' })).toBeInTheDocument()
    resolve({ revision: 4, workspaces: { 'workspace-a': [agent('Claude Code')] } })
    await within(group).findByText('Claude Code')
    expect(group.dataset.state).toBe('working')
  })

  it('falls back to a plain request when the reason is not known yet', async () => {
    renderStrip([agent('Windsurf', { state: 'needs-you', step: 'askYou' })])
    const group = await strip()
    await within(group).findByText('Asking for your help')
    expect(within(group).queryByRole('button', { name: 'Hand back' })).toBeNull()
  })

  it('says when the agent is idle and leads with the first agent, counting the others', async () => {
    renderStrip([agent('Cursor', { state: 'idle' }), agent('Codex'), agent('')])
    const group = await strip()
    await within(group).findByText('Waiting for its next step')
    expect(within(group).getByText('Idle')).toBeInTheDocument()
    const more = within(group).getByRole('img', { name: 'More agents: Codex, Agent' })
    expect(more).toHaveTextContent('+2')
  })

  it('holds its place with no agent, follows presence changes and unpins', async () => {
    const { view, change, unsubscribe } = renderStrip([])
    const group = await strip()
    await within(group).findByText('No agent is working in this workspace')
    expect(group.dataset.state).toBe('none')
    expect(within(group).queryByRole('button', { name: 'Take over' })).toBeNull()

    change({ revision: 2, workspaces: { 'workspace-a': [agent('Claude Code')], 'workspace-b': [agent('Other')] } })
    await within(group).findByText('Opening a page')
    expect(within(group).queryByText('Other')).toBeNull()

    await userEvent.setup().click(within(group).getByRole('button', { name: 'Unpin live status' }))
    expect(view.emitted('unpin')).toHaveLength(1)
    view.unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('has the strip and its setting in every language', () => {
    const keys = [
      'shell.agentCard.pin', 'appearance.agentStrip.label', 'appearance.agentStrip.description',
      ...['label', 'empty', 'pause', 'resume', 'handBack', 'handBackDescription', 'answer', 'answerDescription', 'decision', 'unpin'].map((key) => `shell.agentStrip.${key}`)
    ]
    for (const locale of SUPPORTED_LOCALES) {
      const i18n = createHronautI18n(locale).global
      for (const key of keys) expect(i18n.te(key, locale), `${locale} ${key}`).toBe(true)
    }
  })
})

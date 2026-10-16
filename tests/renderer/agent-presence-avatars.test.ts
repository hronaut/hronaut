import { fireEvent, render, screen, within } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import AgentPresenceAvatars from '../../src/renderer/src/components/AgentPresenceAvatars.vue'
import { useAgentPresence } from '../../src/renderer/src/composables/useAgentPresence.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { AgentCardEvent, AgentCardShowRequest, HronautAgentCardApi } from '../../src/shared/agent-card.js'
import type { AgentPresence, AgentPresenceSnapshot, HronautAgentPresenceApi } from '../../src/shared/agent-presence.js'
import { AGENT_STEP_KINDS, AGENT_STEP_TARGET_KINDS } from '../../src/shared/agent-steps.js'
import { SUPPORTED_LOCALES } from '../../src/shared/locale.js'

function agent(name: string, overrides: Partial<AgentPresence> = {}): AgentPresence {
  return { clientKey: `key-${name}`, name, initial: name.slice(0, 1).toUpperCase(), colorIndex: 1, state: 'working', step: 'click', recentSteps: [], lastTabId: 'tab-2', ...overrides }
}

function fakeApi(initial: Promise<AgentPresenceSnapshot>) {
  let listener!: (snapshot: AgentPresenceSnapshot) => void
  const unsubscribe = vi.fn()
  const api: HronautAgentPresenceApi = { get: vi.fn(() => initial), onChanged: (next) => { listener = next; return unsubscribe } }
  return { api, unsubscribe, change: (snapshot: AgentPresenceSnapshot) => listener(snapshot) }
}

function fakeCardApi() {
  let listener: ((event: AgentCardEvent) => void) | undefined
  const shows: AgentCardShowRequest[] = []
  const api = {
    show: vi.fn((request: AgentCardShowRequest) => { shows.push(request) }),
    hide: vi.fn(),
    onEvent: vi.fn((next: (event: AgentCardEvent) => void) => { listener = next; return () => { listener = undefined } })
  } satisfies HronautAgentCardApi
  return {
    api,
    last: () => shows.at(-1)!,
    emit: (event: AgentCardEvent) => listener?.(event)
  }
}

const TABS = [{ id: 'tab-1' }, { id: 'tab-2' }, { id: 'tab-3' }]

function renderAvatars(agents: AgentPresence[], props: Record<string, unknown> = {}) {
  const { api, unsubscribe, change } = fakeApi(Promise.resolve({ revision: 1, workspaces: { 'workspace-a': agents } }))
  const view = render(AgentPresenceAvatars, {
    global: { plugins: [createHronautI18n('en-US')] },
    props: { workspaceId: 'workspace-a', workspaceName: 'Checkout', activeTabId: 'tab-1', tabs: TABS, cardApi: fakeCardApi().api, api, ...props }
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
    expect(buttons[0]?.querySelector('.agent-avatar-badge')).not.toBeNull()
    expect(buttons[1]?.querySelector('.agent-avatar-badge')).toBeNull()
    expect(buttons[1]?.textContent?.trim()).toBe('C')
  })

  it('names what the current step acts on in the tooltip when main knows it', async () => {
    renderAvatars([
      agent('Claude Code', { step: 'click', target: 'Review order' }),
      agent('Cursor', { step: 'navigate', target: 'shop.example/checkout' }),
      agent('Windsurf', { step: 'read', target: 'ignored' })
    ])
    const group = await screen.findByRole('group', { name: 'Agents in this workspace' })
    expect(within(group).getAllByRole('button').map((button) => button.dataset.tooltip)).toEqual([
      'Claude Code · Clicking “Review order”',
      'Cursor · Opening shop.example/checkout',
      'Windsurf · Reading the page'
    ])
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
    expect(html?.getAttribute('aria-label')).toBe('<img src=x onerror=alert(1)>, working')
    expect(group.querySelector('img')).toBeNull()
    expect(nameless?.getAttribute('aria-label')).toBe('Agent, working')
    expect(nameless?.querySelector('svg')).not.toBeNull()
  })

  it('opens a card for an agent, acting on the tab it asked about or last used', async () => {
    const card = fakeCardApi()
    const { view } = renderAvatars([
      agent('Windsurf', { state: 'needs-you', attentionTabId: 'tab-3', lastTabId: 'tab-2' }),
      agent('Claude Code', { lastTabId: 'tab-1' })
    ], { cardApi: card.api, attentionReason: 'Approve the order.', workspaceName: 'Checkout' })
    const user = userEvent.setup()
    const windsurf = await screen.findByRole('button', { name: 'Windsurf, needs you' })
    expect(windsurf.getAttribute('aria-haspopup')).toBe('dialog')
    expect(windsurf.getAttribute('aria-expanded')).toBe('false')
    await user.click(windsurf)
    await nextTick()
    expect(windsurf.getAttribute('aria-expanded')).toBe('true')
    const shown = card.last()
    expect(shown.model).toMatchObject({
      name: 'Windsurf',
      state: 'needs-you',
      subtitle: 'Connected over MCP · Checkout',
      reason: { text: 'Approve the order.' },
      buttons: [{ action: 'show-tab' }, { action: 'pause' }, { action: 'take-over' }]
    })
    expect(view.emitted('select')).toBeUndefined()
    card.emit({ cardId: shown.cardId, kind: 'action', action: 'show-tab' })
    expect(view.emitted('select')).toEqual([['tab-3']])
    expect(card.api.hide).toHaveBeenCalledWith(shown.cardId)
    await nextTick()
    expect(windsurf.getAttribute('aria-expanded')).toBe('false')

    // The tab already in view needs no Show its tab.
    await user.click(screen.getByRole('button', { name: 'Claude Code, working' }))
    await nextTick()
    expect(card.last().model.buttons.map((button) => button.action)).toEqual(['pause', 'take-over'])
  })

  it('answers the request the card showed, and nothing once a newer request or another agent asks', async () => {
    const card = fakeCardApi()
    const asking = agent('Windsurf', { state: 'needs-you', attentionTabId: 'tab-3' })
    const { view, change } = renderAvatars([asking, agent('Claude Code')], { cardApi: card.api, attentionReason: 'Log in, then hand back.', attentionId: 'attention-1' })
    await fireEvent.click(await screen.findByRole('button', { name: 'Windsurf, needs you' }))
    await nextTick()
    const { cardId, model } = card.last()
    expect(model.reason?.answers?.map((answer) => [answer.action, answer.key])).toEqual([['hand-back', 'attention-1'], ['dismiss', 'attention-1']])
    card.emit({ cardId, kind: 'action', action: 'hand-back', key: 'attention-1' })
    card.emit({ cardId, kind: 'action', action: 'dismiss', key: 'attention-1' })
    expect(view.emitted('answerAttention')).toEqual([['attention-1', 'resolved'], ['attention-1', 'dismissed']])

    // A newer request arrived while the old card's answer was on its way: that answer changes nothing.
    await view.rerender({ attentionReason: 'Approve the order.', attentionId: 'attention-2' })
    card.emit({ cardId, kind: 'action', action: 'hand-back', key: 'attention-1' })
    card.emit({ cardId, kind: 'action', action: 'hand-back' })
    expect(view.emitted('answerAttention')).toHaveLength(2)
    // Nor does one for an agent that no longer asks.
    change({ revision: 2, workspaces: { 'workspace-a': [agent('Windsurf', { state: 'working' }), agent('Claude Code')] } })
    await nextTick()
    card.emit({ cardId, kind: 'action', action: 'hand-back', key: 'attention-2' })
    expect(view.emitted('answerAttention')).toHaveLength(2)
  })

  it('opens the workspace to review a waiting decision, which the card does not answer itself', async () => {
    const card = fakeCardApi()
    const { view } = renderAvatars([agent('Windsurf', { state: 'needs-you' })], {
      cardApi: card.api, attentionReason: 'Human decision required: review-page', attentionId: 'attention-3', attentionDecision: true
    })
    await fireEvent.click(await screen.findByRole('button', { name: 'Windsurf, needs you' }))
    await nextTick()
    const { cardId, model } = card.last()
    expect(model.reason?.answers?.map((answer) => answer.action)).toEqual(['review-decision'])
    card.emit({ cardId, kind: 'action', action: 'hand-back', key: 'attention-3' })
    expect(view.emitted('answerAttention')).toBeUndefined()
    card.emit({ cardId, kind: 'action', action: 'review-decision', key: 'attention-3' })
    expect(view.emitted('reviewDecision')).toEqual([['workspace-a']])
    expect(card.api.hide).toHaveBeenCalledWith(cardId)
  })

  it('answers a waiting decision in the card once it has read it and checked the page', async () => {
    const card = fakeCardApi()
    const waiting = {
      id: 'decision-1', revision: 'revision-1', workspaceId: 'workspace-a', runId: 'run-1', decision: 'review-page' as const, owner: 'local-user', fallbackOwner: 'local-user',
      priorOutcome: 'OUTCOME_UNKNOWN' as const, state: 'WAITING_FOR_HUMAN' as const, createdAt: 1, deadlineAt: 2, notificationAttempts: 1,
      notificationStatus: 'delivered' as const, nextAction: 'REVIEW_CURRENT_STATE' as const
    }
    const browser = {
      listHumanWaiting: vi.fn(async () => [waiting]),
      reviewWorkspaceContinuity: vi.fn(async () => ({
        status: 'BLOCKED' as const, reasons: ['PRIOR_WRITE_OUTCOME_UNKNOWN' as const], priorOutcome: 'OUTCOME_UNKNOWN' as const, nextAction: 'INSPECT_AND_RECONCILE' as const,
        checkpointId: 'checkpoint-1', reviewId: 'review-1', suspended: true, priorOutcomeAcknowledged: false
      })),
      reconcileWorkspaceContinuity: vi.fn(),
      changeHumanWaiting: vi.fn(async () => ({ ...waiting, state: 'REJECTED' as const }))
    }
    const decisionProps = {
      cardApi: card.api, browser, attentionReason: 'Human decision required: review-page', attentionId: 'attention-3', attentionDecision: true,
      attentionDecisionId: 'decision-1', attentionWorkspaceId: 'workspace-a'
    }
    const { view, change } = renderAvatars([agent('Windsurf', { state: 'needs-you' }), agent('Claude Code')], decisionProps)
    const group = await screen.findByRole('group', { name: 'Agents in this workspace' })
    // Nothing is read before a card for the agent that needs you opens.
    await fireEvent.click(within(group).getByRole('button', { name: 'Claude Code, working' }))
    await flushPromises()
    expect(browser.listHumanWaiting).not.toHaveBeenCalled()
    await fireEvent.click(within(group).getByRole('button', { name: 'Windsurf, needs you' }))
    await flushPromises()
    await nextTick()
    expect(browser.listHumanWaiting).toHaveBeenCalledWith('workspace-a')
    const { cardId, model } = card.last()
    expect(model.reason?.decision).toMatchObject({ id: 'decision-1', key: 'decision-1_revision-1', check: { text: 'Hronaut checked this page: Earlier action outcome remains unknown.' } })
    expect(model.reason?.answers?.map((answer) => [answer.action, answer.key])).toEqual([['answer-resolve', 'decision-1_revision-1'], ['review-decision', 'attention-3']])

    // An answer for another revision changes nothing; the one the card showed goes with its note.
    card.emit({ cardId, kind: 'action', action: 'answer-reject', key: 'decision-1_revision-0', note: 'Old' })
    card.emit({ cardId, kind: 'action', action: 'answer-reject', key: 'decision-1_revision-1', note: 'The total is wrong.' })
    await flushPromises()
    expect(browser.changeHumanWaiting.mock.calls).toEqual([['workspace-a', 'decision-1', 'revision-1', 'reject', undefined, 'The total is wrong.']])
    await nextTick()
    expect(card.last().model.reason?.decision).toMatchObject({ status: { text: 'Sent to the agent' }, busy: true })

    // Nor does one for an agent that no longer asks, or a decision in another workspace.
    change({ revision: 2, workspaces: { 'workspace-a': [agent('Windsurf', { state: 'working' }), agent('Claude Code')] } })
    await nextTick()
    card.emit({ cardId, kind: 'action', action: 'answer-resolve', key: 'decision-1_revision-1' })
    await view.rerender({ ...decisionProps, attentionWorkspaceId: 'workspace-b' })
    change({ revision: 3, workspaces: { 'workspace-a': [agent('Windsurf', { state: 'needs-you' }), agent('Claude Code')] } })
    await flushPromises()
    card.emit({ cardId, kind: 'action', action: 'answer-reject', key: 'decision-1_revision-1' })
    await flushPromises()
    expect(browser.changeHumanWaiting).toHaveBeenCalledTimes(1)
    expect(browser.reconcileWorkspaceContinuity).not.toHaveBeenCalled()
  })

  it('completes a page review from the card only after the tick, confirming the page read at the tick', async () => {
    const card = fakeCardApi()
    const waiting = {
      id: 'decision-1', revision: 'revision-1', workspaceId: 'workspace-a', runId: 'run-1', decision: 'review-page' as const, owner: 'local-user', fallbackOwner: 'local-user',
      priorOutcome: 'OUTCOME_UNKNOWN' as const, state: 'WAITING_FOR_HUMAN' as const, createdAt: 1, deadlineAt: 2, notificationAttempts: 1,
      notificationStatus: 'delivered' as const, nextAction: 'REVIEW_CURRENT_STATE' as const
    }
    let review = 0
    const browser = {
      listHumanWaiting: vi.fn(async () => [waiting]),
      reviewWorkspaceContinuity: vi.fn(async () => ({
        status: 'BLOCKED' as const, reasons: ['PRIOR_WRITE_OUTCOME_UNKNOWN' as const], priorOutcome: 'OUTCOME_UNKNOWN' as const, nextAction: 'INSPECT_AND_RECONCILE' as const,
        checkpointId: 'checkpoint-1', reviewId: `review-${++review}`, suspended: true, priorOutcomeAcknowledged: false
      })),
      reconcileWorkspaceContinuity: vi.fn(async () => undefined),
      changeHumanWaiting: vi.fn(async () => ({ ...waiting, state: 'RESOLVED' as const }))
    }
    renderAvatars([agent('Windsurf', { state: 'needs-you' })], {
      cardApi: card.api, browser, attentionReason: 'Human decision required: review-page', attentionId: 'attention-3', attentionDecision: true,
      attentionDecisionId: 'decision-1', attentionWorkspaceId: 'workspace-a'
    })
    await fireEvent.click(await screen.findByRole('button', { name: 'Windsurf, needs you' }))
    await flushPromises()
    await nextTick()
    const { cardId } = card.last()
    // Without the tick, handing back sends nothing.
    card.emit({ cardId, kind: 'action', action: 'answer-resolve', key: 'decision-1_revision-1' })
    await flushPromises()
    expect(browser.reconcileWorkspaceContinuity).not.toHaveBeenCalled()
    expect(browser.changeHumanWaiting).not.toHaveBeenCalled()

    card.emit({ cardId, kind: 'action', action: 'answer-check', key: 'decision-1_revision-1' })
    await flushPromises()
    card.emit({ cardId, kind: 'action', action: 'answer-resolve', key: 'decision-1_revision-1' })
    await flushPromises()
    expect(browser.reviewWorkspaceContinuity).toHaveBeenCalledTimes(2)
    expect(browser.reconcileWorkspaceContinuity.mock.calls).toEqual([['workspace-a', 'review-2', true]])
    expect(browser.changeHumanWaiting.mock.calls).toEqual([['workspace-a', 'decision-1', 'revision-1', 'resolve', undefined, undefined]])
  })

  it('pauses, resumes, takes over and follows from the card, and disables pause while agent control is locked', async () => {
    const card = fakeCardApi()
    const { view } = renderAvatars([agent('Claude Code', { lastTabId: 'tab-2' })], { cardApi: card.api, tabs: [{ id: 'tab-1' }, { id: 'tab-2', agentPaused: true }] })
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Claude Code, working' }))
    await nextTick()
    const { cardId, model } = card.last()
    expect(model.buttons.map((button) => button.action)).toEqual(['show-tab', 'resume', 'take-over'])
    expect(model.cursor).toEqual({ label: 'Show agent cursors on the page', checked: true })
    card.emit({ cardId, kind: 'action', action: 'resume' })
    card.emit({ cardId, kind: 'action', action: 'follow-on' })
    card.emit({ cardId, kind: 'action', action: 'cursor-off' })
    card.emit({ cardId, kind: 'action', action: 'take-over' })
    expect(view.emitted('setPaused')).toEqual([['tab-2', false]])
    expect(view.emitted('setFollow')).toEqual([[true]])
    expect(view.emitted('setShowCursor')).toEqual([[false]])
    expect(view.emitted('takeOver')).toEqual([['tab-2']])
    expect(card.api.hide).toHaveBeenCalledWith(cardId)

    await view.rerender({ agentControlLocked: true })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Claude Code, working' }))
    await nextTick()
    const locked = card.last()
    expect(locked.model.buttons.filter((button) => button.disabled).map((button) => button.action)).toEqual(['resume', 'take-over'])
    card.emit({ cardId: locked.cardId, kind: 'action', action: 'pause' })
    card.emit({ cardId: locked.cardId, kind: 'action', action: 'take-over' })
    expect(view.emitted('setPaused')).toHaveLength(1)
    expect(view.emitted('takeOver')).toHaveLength(1)
  })

  it('keeps the tab a needs-you avatar showed when pressed, even if pressing answered the request first', async () => {
    const card = fakeCardApi()
    const asking = agent('Windsurf', { state: 'needs-you', attentionTabId: 'tab-3', lastTabId: 'tab-2' })
    const answered = agent('Windsurf', { lastTabId: 'tab-2' })
    const { view, change } = renderAvatars([asking], { cardApi: card.api })
    const button = await screen.findByRole('button', { name: 'Windsurf, needs you' })
    // Main answers the request on the shell's mousedown, before the click lands.
    await fireEvent.pointerDown(button)
    change({ revision: 2, workspaces: { 'workspace-a': [answered] } })
    await nextTick()
    await fireEvent.click(button)
    await nextTick()
    card.emit({ cardId: card.last().cardId, kind: 'action', action: 'show-tab' })
    // The same with the keyboard.
    change({ revision: 3, workspaces: { 'workspace-a': [asking] } })
    await nextTick()
    await fireEvent.keyDown(button, { key: 'Enter' })
    change({ revision: 4, workspaces: { 'workspace-a': [answered] } })
    await nextTick()
    await fireEvent.click(button)
    await nextTick()
    card.emit({ cardId: card.last().cardId, kind: 'action', action: 'show-tab' })
    // A press that leaves the avatar does not count for a later click.
    change({ revision: 5, workspaces: { 'workspace-a': [asking] } })
    await nextTick()
    await fireEvent.pointerDown(button)
    await fireEvent.pointerLeave(button)
    change({ revision: 6, workspaces: { 'workspace-a': [answered] } })
    await nextTick()
    await fireEvent.click(button)
    await nextTick()
    card.emit({ cardId: card.last().cardId, kind: 'action', action: 'show-tab' })
    expect(view.emitted('select')).toEqual([['tab-3'], ['tab-3'], ['tab-2']])
  })

  it('closes the open card when its avatar is pressed again, whichever arrives first', async () => {
    const card = fakeCardApi()
    renderAvatars([agent('Claude Code', { lastTabId: 'tab-2' })], { cardApi: card.api })
    const button = await screen.findByRole('button', { name: 'Claude Code, working' })
    const pressAt = async (timeStamp: number) => {
      const event = new Event('pointerdown', { bubbles: true })
      Object.defineProperty(event, 'timeStamp', { value: timeStamp })
      button.dispatchEvent(event)
      await nextTick()
    }
    await fireEvent.click(button)
    await nextTick()
    // The press moves focus out of the card, which closes it after the press arrives...
    await pressAt(performance.now())
    card.emit({ cardId: card.last().cardId, kind: 'closed', reason: 'blur' })
    await fireEvent.click(button)
    await nextTick()
    // ...or before it: the press happened before the shell heard the card closed.
    await fireEvent.click(button)
    await nextTick()
    const pressed = performance.now()
    card.emit({ cardId: card.last().cardId, kind: 'closed', reason: 'blur' })
    await pressAt(pressed)
    await fireEvent.click(button)
    await nextTick()
    expect(card.api.show).toHaveBeenCalledTimes(2)
    expect(button.getAttribute('aria-expanded')).toBe('false')
    // A click after a card closed by a click on the page opens it again, however soon.
    await fireEvent.click(button)
    await nextTick()
    card.emit({ cardId: card.last().cardId, kind: 'closed', reason: 'blur' })
    await pressAt(performance.now() + 1)
    await fireEvent.click(button)
    await nextTick()
    expect(card.api.show).toHaveBeenCalledTimes(4)
    expect(button.getAttribute('aria-expanded')).toBe('true')
  })

  it('returns focus to the avatar when Esc closes the card', async () => {
    const card = fakeCardApi()
    renderAvatars([agent('Claude Code')], { cardApi: card.api })
    const button = await screen.findByRole('button', { name: 'Claude Code, working' })
    await fireEvent.click(button)
    await nextTick()
    button.blur()
    card.emit({ cardId: card.last().cardId, kind: 'closed', reason: 'escape' })
    await nextTick()
    await nextTick()
    expect(document.activeElement).toBe(button)
  })

  it('keeps the avatar of an agent that disconnects while its card is open, until the card closes', async () => {
    const card = fakeCardApi()
    const { change } = renderAvatars([agent('Windsurf', { state: 'needs-you', attentionTabId: 'tab-3' }), agent('Claude Code')], { cardApi: card.api })
    await fireEvent.click(await screen.findByRole('button', { name: 'Windsurf, needs you' }))
    await nextTick()
    change({ revision: 2, workspaces: { 'workspace-a': [agent('Claude Code')] } })
    await nextTick()
    await nextTick()
    const departed = screen.getByRole('button', { name: 'Windsurf, disconnected' })
    expect(departed.dataset.state).toBe('gone')
    expect(departed.querySelector('.agent-avatar-badge')).toBeNull()
    const { cardId, model } = card.last()
    expect(model).toMatchObject({ state: 'idle', stateLabel: 'Disconnected', now: { text: 'No longer connected to this workspace' } })
    expect(model.reason).toBeUndefined()
    expect(model.buttons.map((button) => button.action)).toEqual(['show-tab', 'pause', 'take-over'])
    card.emit({ cardId, kind: 'closed', reason: 'blur' })
    await nextTick()
    expect(screen.queryByRole('button', { name: /^Windsurf/ })).toBeNull()
  })

  it('keeps the open card\'s agent among the visible avatars when others would push it into +N', async () => {
    const card = fakeCardApi()
    const idle = (name: string) => agent(name, { state: 'idle' })
    const { change } = renderAvatars([agent('Claude Code'), idle('Cursor'), idle('Zed'), idle('Aider')], { cardApi: card.api })
    await fireEvent.click(await screen.findByRole('button', { name: 'Zed, idle' }))
    await nextTick()
    const { cardId } = card.last()
    // Aider starts working and sorts before the idle ones; Zed would become fourth.
    change({ revision: 2, workspaces: { 'workspace-a': [agent('Claude Code'), agent('Aider'), idle('Cursor'), idle('Zed')] } })
    await nextTick()
    await nextTick()
    const group = screen.getByRole('group', { name: 'Agents in this workspace' })
    expect(within(group).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['Claude Code, working', 'Aider, working', 'Zed, idle'])
    expect(card.api.hide).not.toHaveBeenCalled()
    expect(card.last()).toMatchObject({ cardId, model: { name: 'Zed' } })
    card.emit({ cardId, kind: 'closed', reason: 'blur' })
    await nextTick()
    expect(within(group).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['Claude Code, working', 'Aider, working', 'Cursor, idle'])
  })

  it('closes the card when the workspace in view changes', async () => {
    const card = fakeCardApi()
    const { view } = renderAvatars([agent('Claude Code')], { cardApi: card.api })
    await fireEvent.click(await screen.findByRole('button', { name: 'Claude Code, working' }))
    await nextTick()
    const { cardId } = card.last()
    await view.rerender({ workspaceId: 'workspace-b' })
    await nextTick()
    expect(card.api.hide).toHaveBeenCalledWith(cardId)
  })

  it('opens the card of the agent that needs you from the shortcut, or else the first one', async () => {
    const card = fakeCardApi()
    const { api, change } = fakeApi(Promise.resolve({ revision: 1, workspaces: { 'workspace-a': [agent('Claude Code'), agent('Windsurf', { state: 'needs-you' })] } }))
    const wrapper = mount(AgentPresenceAvatars, {
      attachTo: document.body,
      global: { plugins: [createHronautI18n('en-US')] },
      props: { workspaceId: 'workspace-a', activeTabId: 'tab-1', tabs: TABS, api, cardApi: card.api }
    })
    await flushPromises()
    const avatars = wrapper.vm as unknown as { openCard: () => boolean }
    try {
      expect(avatars.openCard()).toBe(true)
      await nextTick()
      expect(card.last().model.name).toBe('Windsurf')
      card.emit({ cardId: card.last().cardId, kind: 'closed', reason: 'escape' })
      change({ revision: 2, workspaces: { 'workspace-a': [agent('Claude Code')] } })
      await nextTick()
      expect(avatars.openCard()).toBe(true)
      await nextTick()
      expect(card.last().model.name).toBe('Claude Code')
      card.emit({ cardId: card.last().cardId, kind: 'closed', reason: 'escape' })
      change({ revision: 3, workspaces: {} })
      await nextTick()
      expect(avatars.openCard()).toBe(false)
    } finally {
      wrapper.unmount()
    }
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
      const i18n = createHronautI18n(locale).global
      for (const key of [...AGENT_STEP_KINDS.map((kind) => `shell.agents.steps.${kind}`), 'shell.agents.states.idle', 'shell.agents.states.working', 'shell.agents.states.needsYou', 'shell.agents.group', 'shell.agents.more', 'shell.agents.needsYouReason']) {
        expect(i18n.te(key, locale), `${locale} ${key}`).toBe(true)
        expect(i18n.t(key, { name: 'N', state: 'S', step: 'P', reason: 'R', names: 'A, B' }), `${locale} ${key}`).not.toBe(key)
      }
      for (const key of AGENT_STEP_TARGET_KINDS.map((kind) => `shell.agents.targetSteps.${kind}`)) {
        expect(i18n.te(key, locale), `${locale} ${key}`).toBe(true)
        expect(i18n.t(key, { target: 'Ztarget' }), `${locale} ${key}`).toContain('Ztarget')
      }
    }
  })
})

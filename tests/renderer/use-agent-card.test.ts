import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { agentCardModel, fitAgentCardText, useAgentCard, type AgentCardContext } from '../../src/renderer/src/composables/useAgentCard.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { AgentCardEvent, AgentCardModel, AgentCardShowRequest, HronautAgentCardApi } from '../../src/shared/agent-card.js'
import { parseAgentCardModel } from '../../src/shared/agent-card.js'
import type { AgentPresence } from '../../src/shared/agent-presence.js'
import { AGENT_STEP_KINDS } from '../../src/shared/agent-steps.js'
import { SUPPORTED_LOCALES } from '../../src/shared/locale.js'

const t = createHronautI18n('en-US').global.t as (key: string, values?: Record<string, unknown>) => string

function agent(overrides: Partial<AgentPresence> = {}): AgentPresence {
  return { clientKey: 'key-claude', name: 'Claude Code', initial: 'C', colorIndex: 1, state: 'working', step: 'read', recentSteps: [], ...overrides }
}

function context(overrides: Partial<AgentCardContext> = {}): AgentCardContext {
  return { workspaceName: 'Checkout', follow: false, tab: { id: 'tab-2', agentPaused: false }, tabInView: false, agentControlLocked: false, color: '#2aa198', name: 'Claude Code', ...overrides }
}

describe('agent card content', () => {
  it('describes a working agent with its recent steps and what you can do', () => {
    const card = agentCardModel(agent({
      recentSteps: [{ step: 'click', outcome: 'failed', at: 3 }, { step: 'navigate', outcome: 'done', at: 2 }]
    }), context(), t)
    expect(card).toEqual({
      label: 'Claude Code, agent details',
      name: 'Claude Code',
      initial: 'C',
      color: '#2aa198',
      state: 'working',
      stateLabel: 'Working',
      subtitle: 'Connected over MCP · Checkout',
      now: { heading: 'Now', text: 'Reading the page' },
      recent: { heading: 'Recent steps', empty: 'No finished steps yet', steps: [{ text: 'Clicked on the page, failed', failed: true }, { text: 'Opened a page' }] },
      follow: { label: 'Follow agents in all workspaces', checked: false },
      buttons: [
        { action: 'show-tab', label: 'Show its tab' },
        { action: 'pause', label: 'Pause on this tab' },
        { action: 'take-over', label: 'Take over' }
      ],
      closeLabel: 'Close'
    })
    // What the shell builds is what main accepts.
    expect(parseAgentCardModel(card)).toEqual(card)
  })

  it('shows why it needs you, offers Resume on a paused tab, and disables both while control is locked', () => {
    const card = agentCardModel(agent({ state: 'needs-you', step: 'askYou' }), context({
      attentionReason: 'Approve the order.', tab: { id: 'tab-2', agentPaused: true }, tabInView: true, agentControlLocked: true, follow: true
    }), t)
    expect(card.reason).toEqual({ heading: 'Why it needs you', text: 'Approve the order.' })
    expect(card.stateLabel).toBe('Needs you')
    expect(card.follow.checked).toBe(true)
    expect(card.buttons).toEqual([
      { action: 'resume', label: 'Resume on this tab', disabled: true },
      { action: 'take-over', label: 'Take over', disabled: true }
    ])
  })

  it('offers no tab actions without a tab, and says when an idle agent waits or a disconnected one left', () => {
    expect(agentCardModel(agent({ state: 'idle' }), context({ tab: undefined }), t)).toMatchObject({ buttons: [], now: { text: 'Waiting for its next step' } })
    const gone = agentCardModel(agent({ state: 'needs-you' }), context({ gone: true, attentionReason: 'Old request.' }), t)
    expect(gone).toMatchObject({ state: 'idle', stateLabel: 'Disconnected', now: { text: 'No longer connected to this workspace' } })
    expect(gone.reason).toBeUndefined()
  })

  it('keeps a long name, workspace or reason within the card contract', () => {
    // 64 graphemes, each a letter with eight combining marks: within the toolbar's limit, 576 code units.
    const name = 'e\u0301\u0302\u0303\u0304\u0306\u0307\u0308\u030a'.repeat(64)
    const card = agentCardModel(agent({ initial: 'E\u0301\u0302\u0303\u0304\u0306\u0307\u0308\u030a' }), context({ name, workspaceName: 'w'.repeat(400), attentionReason: 'r'.repeat(3_000) }), t)
    expect(parseAgentCardModel(card)).toEqual(card)
    expect(card.initial).toBe('')
    expect(card.name.endsWith('…')).toBe(true)
    expect(fitAgentCardText('😀'.repeat(10), 6)).toBe('😀😀…')
    expect(fitAgentCardText('short', 6)).toBe('short')
  })

  it('has every card phrase in every language', () => {
    const keys = [
      'label', 'connected', 'states.idle', 'states.working', 'states.needsYou', 'states.gone', 'reason', 'now', 'nowIdle', 'gone',
      'recent', 'noSteps', 'stepFailed', 'follow', 'showTab', 'pause', 'resume', 'takeOver', 'close',
      ...AGENT_STEP_KINDS.map((kind) => `steps.${kind}`)
    ].map((key) => `shell.agentCard.${key}`)
    for (const locale of SUPPORTED_LOCALES) {
      const i18n = createHronautI18n(locale).global
      for (const key of [...keys, 'shell.agents.states.gone', 'shell.agents.gone']) {
        expect(i18n.te(key, locale), `${locale} ${key}`).toBe(true)
        expect(i18n.t(key, { name: 'N', workspace: 'W', step: 'S' }), `${locale} ${key}`).not.toBe(key)
      }
    }
  })
})

function fakeApi() {
  let listener: ((event: AgentCardEvent) => void) | undefined
  const shows: AgentCardShowRequest[] = []
  const api = {
    show: vi.fn((request: AgentCardShowRequest) => { shows.push(request) }),
    hide: vi.fn(),
    onEvent: vi.fn((next: (event: AgentCardEvent) => void) => { listener = next; return () => { listener = undefined } })
  } satisfies HronautAgentCardApi
  return { api, shows, emit: (event: AgentCardEvent) => listener?.(event), listening: () => listener !== undefined }
}

function anchor(): HTMLElement {
  const element = document.createElement('button')
  document.body.append(element)
  element.getBoundingClientRect = () => ({ x: 600, y: 8, left: 600, top: 8, width: 32, height: 32, right: 632, bottom: 40, toJSON: () => ({}) })
  return element
}

function setup() {
  const { api, shows, emit, listening } = fakeApi()
  const models = ref<Record<string, AgentCardModel | undefined>>({ a: agentCardModel(agent(), context(), t), b: agentCardModel(agent({ clientKey: 'b', name: 'Cursor' }), context({ name: 'Cursor' }), t) })
  const anchors: Record<string, HTMLElement | null> = { a: anchor(), b: anchor() }
  const onAction = vi.fn()
  const onClosed = vi.fn()
  const scope = effectScope()
  const card = scope.run(() => useAgentCard({ api, model: (key) => models.value[key], anchor: (key) => anchors[key] ?? null, onAction, onClosed }))!
  return { api, shows, emit, listening, models, anchors, onAction, onClosed, scope, card }
}

describe('agent card lifecycle', () => {
  it('shows the card under its avatar and keeps it current while it is open', async () => {
    document.documentElement.dataset.theme = 'dark'
    const { card, shows, models } = setup()
    card.open('a')
    await nextTick()
    expect(shows).toHaveLength(1)
    expect(shows[0]).toMatchObject({ anchor: { x: 600, y: 8, width: 32, height: 32 }, theme: 'dark', model: { name: 'Claude Code' } })
    models.value = { ...models.value, a: { ...models.value.a!, stateLabel: 'Idle' } }
    await nextTick()
    expect(shows).toHaveLength(2)
    expect(shows[1]).toMatchObject({ cardId: shows[0].cardId, model: { stateLabel: 'Idle' } })
    // A state push that changes nothing on the card, such as another tab's title, sends nothing.
    models.value = { ...models.value, a: { ...models.value.a! } }
    await nextTick()
    expect(shows).toHaveLength(2)
  })

  it('ignores events of a card that closed or was replaced, and reports its own', async () => {
    const { card, shows, emit, onAction, onClosed, api } = setup()
    card.open('a')
    await nextTick()
    const first = shows[0].cardId
    card.open('b')
    await nextTick()
    const second = shows.at(-1)!.cardId
    expect(second).not.toBe(first)
    emit({ cardId: first, kind: 'action', action: 'pause' })
    emit({ cardId: first, kind: 'closed', reason: 'blur' })
    expect(onAction).not.toHaveBeenCalled()
    expect(card.openKey.value).toBe('b')
    emit({ cardId: second, kind: 'action', action: 'take-over' })
    expect(onAction).toHaveBeenCalledWith('b', 'take-over')
    emit({ cardId: second, kind: 'closed', reason: 'escape' })
    expect(onClosed).toHaveBeenCalledWith('b', 'escape')
    expect(card.openKey.value).toBeNull()
    // The card main closed needs no hide from the shell.
    expect(api.hide).not.toHaveBeenCalled()
    // A late event after it closed changes nothing.
    emit({ cardId: second, kind: 'action', action: 'pause' })
    expect(onAction).toHaveBeenCalledOnce()
  })

  it('closes the card when its agent or its avatar goes away, and when the scope ends', async () => {
    const { card, shows, models, anchors, api, scope, listening } = setup()
    card.open('a')
    await nextTick()
    models.value = { ...models.value, a: undefined }
    await nextTick()
    expect(api.hide).toHaveBeenCalledWith(shows[0].cardId)
    expect(card.openKey.value).toBeNull()

    card.open('b')
    await nextTick()
    anchors.b!.remove()
    models.value = { ...models.value }
    await nextTick()
    expect(api.hide).toHaveBeenLastCalledWith(shows.at(-1)!.cardId)

    card.open('b')
    anchors.b = anchor()
    models.value = { ...models.value }
    await nextTick()
    scope.stop()
    expect(api.hide).toHaveBeenLastCalledWith(shows.at(-1)!.cardId)
    expect(listening()).toBe(false)
  })
})

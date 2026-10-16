import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { agentCardModel, fitAgentCardText, useAgentCard, type AgentCardContext } from '../../src/renderer/src/composables/useAgentCard.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { AgentCardEvent, AgentCardModel, AgentCardShowRequest, HronautAgentCardApi } from '../../src/shared/agent-card.js'
import { parseAgentCardModel } from '../../src/shared/agent-card.js'
import type { AgentPresence } from '../../src/shared/agent-presence.js'
import { AGENT_STEP_KINDS, AGENT_STEP_TARGET_KINDS } from '../../src/shared/agent-steps.js'
import { SUPPORTED_LOCALES } from '../../src/shared/locale.js'

const t = createHronautI18n('en-US').global.t as (key: string, values?: Record<string, unknown>) => string

function agent(overrides: Partial<AgentPresence> = {}): AgentPresence {
  return { clientKey: 'key-claude', name: 'Claude Code', initial: 'C', colorIndex: 1, state: 'working', step: 'read', recentSteps: [], ...overrides }
}

function context(overrides: Partial<AgentCardContext> = {}): AgentCardContext {
  return { workspaceName: 'Checkout', follow: false, showCursor: true, tab: { id: 'tab-2', agentPaused: false }, tabInView: false, agentControlLocked: false, color: '#2aa198', name: 'Claude Code', ...overrides }
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
      cursor: { label: 'Show agent cursors on the page', checked: true },
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
    expect(agentCardModel(agent(), context({ showCursor: false }), t).cursor).toEqual({ label: 'Show agent cursors on the page', checked: false })
    expect(card.buttons).toEqual([
      { action: 'resume', label: 'Resume on this tab', disabled: true },
      { action: 'take-over', label: 'Take over', disabled: true }
    ])
  })

  it('answers a request from the card with its id: hand back or dismiss, or review a decision', () => {
    const asking = agent({ state: 'needs-you', step: 'askYou' })
    const plain = agentCardModel(asking, context({ attentionReason: 'Log in, then hand back.', attentionId: 'attention-1' }), t)
    expect(plain.reason).toEqual({
      heading: 'Why it needs you',
      text: 'Log in, then hand back.',
      answers: [{ action: 'hand-back', label: 'Done, hand back', key: 'attention-1' }, { action: 'dismiss', label: 'Dismiss', key: 'attention-1' }]
    })
    expect(parseAgentCardModel(plain)).toEqual(plain)
    const decision = agentCardModel(asking, context({ attentionReason: 'Human decision required: review-page', attentionId: 'attention-2', attentionDecision: true }), t)
    expect(decision.reason?.answers).toEqual([{ action: 'review-decision', label: 'Review the decision', key: 'attention-2' }])
    // Without the request's id there is nothing to answer.
    expect(agentCardModel(asking, context({ attentionReason: 'Log in.' }), t).reason?.answers).toBeUndefined()
  })

  describe('a decision answered in the card', () => {
    const asking = agent({ state: 'needs-you', step: 'askYou' })
    const unknown = { status: 'confirm' as const, reasons: ['CHECKPOINT_UNAVAILABLE' as const, 'PRIOR_WRITE_OUTCOME_UNKNOWN' as const], unknownOutcome: true, token: 'check-7' }
    function decide(decision: NonNullable<AgentCardContext['decision']>) {
      const card = agentCardModel(asking, context({ attentionReason: 'Human decision required: x', attentionId: 'attention-2', attentionDecision: true, decision }), t)
      // What the shell builds is what main accepts.
      expect(parseAgentCardModel(card)).toEqual(card)
      return card.reason!
    }

    it('hands a page back after the page check, or sends it back with what to fix', () => {
      const reason = decide({ key: 'd1_r1', id: 'd1', revision: 'r1', decision: 'review-page', check: unknown, phase: 'idle' })
      expect(reason.text).toBe('Look at the page, then hand it back or tell the agent what to fix.')
      expect(reason.answers).toEqual([
        { action: 'answer-resolve', label: 'Looks good, hand back', key: 'd1_r1', needsCheck: true },
        { action: 'review-decision', label: 'Open in workspace', key: 'attention-2' }
      ])
      expect(reason.decision).toEqual({
        id: 'd1',
        key: 'd1_r1',
        check: {
          id: 'check-7',
          text: 'Hronaut checked this page: Checkpoint unavailable · Earlier action outcome remains unknown.',
          confirm: 'I reviewed the page and understand that the earlier action may already have taken effect.'
        },
        field: { label: 'What should the agent fix? (optional)', required: false, toggle: 'Something wrong?', send: { action: 'answer-reject', label: 'Send back', key: 'd1_r1' } }
      })
      // Nothing to confirm: the answer is free. A stale reading asks only to confirm the page.
      expect(decide({ key: 'd1_r1', id: 'd1', revision: 'r1', decision: 'review-page', check: { status: 'clear', reasons: [] }, phase: 'idle' }).answers?.[0])
        .toEqual({ action: 'answer-resolve', label: 'Looks good, hand back', key: 'd1_r1' })
      expect(decide({ key: 'd1_r1', id: 'd1', revision: 'r1', decision: 'review-page', check: { status: 'confirm', reasons: [], unknownOutcome: false, token: 'check-8' }, phase: 'idle' }).decision?.check)
        .toEqual({ id: 'check-8', text: 'Hronaut checked this page.', confirm: 'I looked at the page as it is now.' })
    })

    it('offers no hand back while the page is being checked or cannot be checked here', () => {
      const checking = decide({ key: 'd1_r1', id: 'd1', revision: 'r1', decision: 'review-page', check: { status: 'checking' }, phase: 'idle' })
      expect(checking.answers?.map((answer) => answer.action)).toEqual(['review-decision'])
      expect(checking.decision?.status).toEqual({ text: 'Checking the page…' })
      const unavailable = decide({ key: 'd2_r1', id: 'd2', revision: 'r1', decision: 'provide-input', check: { status: 'unavailable', reasons: ['EVIDENCE_UNAVAILABLE'] }, phase: 'idle' })
      expect(unavailable.answers?.map((answer) => answer.action)).toEqual(['review-decision'])
      expect(unavailable.decision?.field).toBeUndefined()
      expect(unavailable.decision?.status).toEqual({ text: 'Hronaut can’t check this page from here. Open it in the workspace to answer.' })
      // Reading the page again keeps the input field and what you typed in it, with Send waiting.
      const rechecking = decide({ key: 'd2_r2', id: 'd2', revision: 'r2', decision: 'provide-input', check: { status: 'checking' }, phase: 'failed' })
      expect(rechecking.decision?.field?.send).toEqual({ action: 'answer-resolve', label: 'Send', key: 'd2_r2', disabled: true })
      expect(rechecking.decision?.status).toEqual({ text: 'That didn’t go through. Try again, or open it in the workspace.', alert: true })
    })

    it('asks for the input the agent needs, and says how sending went', () => {
      const reason = decide({ key: 'd2_r1', id: 'd2', revision: 'r1', decision: 'provide-input', check: unknown, phase: 'idle' })
      expect(reason.text).toBe('The agent needs your answer to carry on.')
      expect(reason.answers).toEqual([{ action: 'review-decision', label: 'Open in workspace', key: 'attention-2' }])
      expect(reason.decision?.field).toEqual({ label: 'Your answer for the agent', required: true, send: { action: 'answer-resolve', label: 'Send', key: 'd2_r1', needsCheck: true } })
      const phases = (['sending', 'sent', 'failed', 'changed'] as const).map((phase) => decide({ key: 'd2_r1', id: 'd2', revision: 'r1', decision: 'provide-input', check: unknown, phase }).decision)
      expect(phases.map((decision) => [decision?.status, decision?.busy])).toEqual([
        [{ text: 'Sending…' }, true],
        [{ text: 'Sent to the agent' }, true],
        [{ text: 'That didn’t go through. Try again, or open it in the workspace.', alert: true }, undefined],
        [{ text: 'Confirm the page again: it changed, or more than 30 seconds passed since you confirmed it.', alert: true }, undefined]
      ])
    })

    it('shows what an approval would do, leaves approving to the workspace and can reject it', () => {
      const step = { toolName: 'browser_click', actionClass: 'interact' as const, reversibility: 'irreversible' as const, representation: 'bounded-description' as const, description: 'Submit the order', origin: 'https://shop.example', artifactHash: 'a'.repeat(64) }
      const reason = decide({
        key: 'd3_r1', id: 'd3', revision: 'r1', decision: 'approve-action', phase: 'idle',
        steps: [step, { ...step, representation: 'visible-browser-only', description: undefined, origin: undefined, reversibility: 'unknown' }, step, step, step]
      })
      expect(reason.text).toBe('The agent wants your approval before it acts.')
      expect(reason.answers).toEqual([{ action: 'review-decision', label: 'Review and approve', key: 'attention-2' }])
      expect(reason.decision?.plan?.heading).toBe('What it will do')
      expect(reason.decision?.plan?.steps).toHaveLength(4)
      expect(reason.decision?.plan?.more).toBe('+1 more, shown in the workspace')
      expect(reason.decision?.plan?.steps.slice(0, 2)).toEqual([
        { text: 'Submit the order', detail: 'Irreversible · https://shop.example' },
        { text: 'The mutation cannot be represented safely as text. Inspect the visible browser before deciding.', detail: 'Unknown' }
      ])
      expect(reason.decision?.check).toBeUndefined()
      expect(reason.decision?.field).toEqual({ label: 'Reason for the agent (optional)', required: false, toggle: 'Reject…', send: { action: 'answer-reject', label: 'Reject', key: 'd3_r1' } })
      // Nothing in the card completes an approval.
      expect(JSON.stringify(reason)).not.toContain('answer-resolve')
    })

    it('leaves an unknown outcome, and a decision not read yet, to the workspace', () => {
      const unresolved = decide({ key: 'd4_r1', id: 'd4', revision: 'r1', decision: 'resolve-unknown', phase: 'idle' })
      expect(unresolved).toEqual({ heading: 'Why it needs you', text: 'The agent can’t tell whether its last action took effect.', answers: [{ action: 'review-decision', label: 'Review the decision', key: 'attention-2' }] })
      const card = agentCardModel(asking, context({ attentionReason: 'Human decision required: review-page', attentionId: 'attention-2', attentionDecision: true }), t)
      expect(card.reason).toEqual({ heading: 'Why it needs you', text: 'Human decision required: review-page', answers: [{ action: 'review-decision', label: 'Review the decision', key: 'attention-2' }] })
    })
  })

  it('names what a step acts on when main knows it, and keeps the general phrase otherwise', () => {
    const card = agentCardModel(agent({
      step: 'click',
      target: 'Review order',
      recentSteps: [
        { step: 'type', outcome: 'done', at: 3, target: 'Promo code' },
        { step: 'click', outcome: 'failed', at: 2, target: 'Pay' },
        { step: 'openTab', outcome: 'done', at: 1, target: 'shop.example/checkout' },
        { step: 'read', outcome: 'done', at: 0, target: 'ignored' },
        { step: 'type', outcome: 'done', at: 0 }
      ]
    }), context(), t)
    expect(card.now.text).toBe('Clicking “Review order”')
    expect(card.recent.steps).toEqual([
      { text: 'Typed in Promo code' },
      { text: 'Clicked “Pay”, failed', failed: true },
      { text: 'Opened shop.example/checkout in a new tab' },
      // A step that takes no target keeps its general phrase, as does one whose target main did not know.
      { text: 'Read the page' },
      { text: 'Typed' }
    ])
    // The longest target still fits the card contract.
    const long = agentCardModel(agent({ target: 'x'.repeat(120), recentSteps: [{ step: 'click', outcome: 'done', at: 1, target: 'y'.repeat(120) }] }), context(), t)
    expect(parseAgentCardModel(long)).toEqual(long)
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
      'recent', 'noSteps', 'stepFailed', 'follow', 'cursor', 'showTab', 'pause', 'resume', 'takeOver', 'handBack', 'dismiss', 'reviewDecision', 'close',
      'openDecision', 'looksGood', 'somethingWrong', 'whatToFix', 'sendBack', 'send', 'reviewAndApprove', 'whatItWillDo', 'stepDetail', 'rejectToggle',
      'rejectReason', 'reject', 'checked', 'checkedPage', 'confirmPage', 'checking', 'checkUnavailable', 'answerSending', 'answerSent', 'answerFailed', 'answerChanged', 'moreSteps',
      'decisionReasons.review-page', 'decisionReasons.provide-input', 'decisionReasons.approve-action', 'decisionReasons.resolve-unknown',
      ...AGENT_STEP_KINDS.map((kind) => `steps.${kind}`)
    ].map((key) => `shell.agentCard.${key}`)
    for (const locale of SUPPORTED_LOCALES) {
      const i18n = createHronautI18n(locale).global
      for (const key of [...keys, 'shell.agents.states.gone', 'shell.agents.gone']) {
        expect(i18n.te(key, locale), `${locale} ${key}`).toBe(true)
        expect(i18n.t(key, { name: 'N', workspace: 'W', step: 'S' }), `${locale} ${key}`).not.toBe(key)
      }
      expect(i18n.t('shell.agentCard.checked', { reasons: 'Zreasons' }), locale).toContain('Zreasons')
      expect(i18n.t('shell.agentCard.stepDetail', { reversibility: 'Zrev', origin: 'Zorigin' }), locale).toMatch(/Zrev.*Zorigin/u)
      expect(i18n.t('shell.agentCard.moreSteps', { count: 9 }), locale).toContain('9')
      for (const key of AGENT_STEP_TARGET_KINDS.map((kind) => `shell.agentCard.targetSteps.${kind}`)) {
        expect(i18n.te(key, locale), `${locale} ${key}`).toBe(true)
        expect(i18n.t(key, { target: 'Ztarget' }), `${locale} ${key}`).toContain('Ztarget')
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
    expect(onAction).toHaveBeenCalledWith('b', 'take-over', undefined, undefined)
    // An answer carries the key of the request the card showed, and a decision's answer what you wrote.
    emit({ cardId: second, kind: 'action', action: 'hand-back', key: 'attention-1' })
    expect(onAction).toHaveBeenLastCalledWith('b', 'hand-back', 'attention-1', undefined)
    emit({ cardId: second, kind: 'action', action: 'answer-reject', key: 'd1_r1', note: 'Wrong total' })
    expect(onAction).toHaveBeenLastCalledWith('b', 'answer-reject', 'd1_r1', 'Wrong total')
    emit({ cardId: second, kind: 'closed', reason: 'escape' })
    expect(onClosed).toHaveBeenCalledWith('b', 'escape')
    expect(card.openKey.value).toBeNull()
    // The card main closed needs no hide from the shell.
    expect(api.hide).not.toHaveBeenCalled()
    // A late event after it closed changes nothing.
    emit({ cardId: second, kind: 'action', action: 'pause' })
    expect(onAction).toHaveBeenCalledTimes(3)
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

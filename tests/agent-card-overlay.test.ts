import { describe, expect, it, vi } from 'vitest'
import { AgentCardOverlay, placeAgentCard, type AgentCardSurface } from '../src/main/agent-card-overlay.js'
import {
  parseAgentCardMeasurement,
  parseAgentCardShowRequest,
  parseAgentCardViewMessage,
  type AgentCardModel,
  type AgentCardShowRequest
} from '../src/shared/agent-card.js'

function model(overrides: Partial<AgentCardModel> = {}): AgentCardModel {
  return {
    label: 'Claude Code, agent details',
    name: 'Claude Code',
    initial: 'C',
    color: '#2aa198',
    state: 'working',
    stateLabel: 'Working',
    subtitle: 'Connected over MCP · Checkout',
    now: { heading: 'Now', text: 'Reading the page' },
    recent: { heading: 'Recent steps', empty: 'No finished steps yet', steps: [{ text: 'Opened a page' }, { text: 'Clicked, failed', failed: true }] },
    follow: { label: 'Follow agents in all workspaces', checked: false },
    cursor: { label: 'Show agent cursors on the page', checked: true },
    pin: { label: 'Pin live status below the toolbar', checked: false },
    buttons: [{ action: 'pause', label: 'Pause on this tab' }, { action: 'take-over', label: 'Take over', disabled: true }],
    closeLabel: 'Close',
    ...overrides
  }
}

function request(cardId = 1, overrides: Partial<AgentCardShowRequest> = {}): AgentCardShowRequest {
  return { cardId, anchor: { x: 600, y: 8, width: 32, height: 32 }, theme: 'light', model: model(), ...overrides }
}

describe('agent card contracts', () => {
  it('accepts a card the shell built and refuses anything outside the contract', () => {
    expect(parseAgentCardShowRequest(request())).toEqual(request())
    const bad: unknown[] = [
      { ...request(), cardId: 0 },
      { ...request(), theme: 'neon' },
      { ...request(), anchor: { x: Number.NaN, y: 0, width: 1, height: 1 } },
      { ...request(), model: model({ color: 'red' }) },
      { ...request(), model: { ...model(), state: 'sleeping' } },
      { ...request(), model: model({ name: ' ' }) },
      { ...request(), model: model({ subtitle: 'x'.repeat(301) }) },
      { ...request(), model: { ...model(), buttons: [{ action: 'eval', label: 'Run' }] } },
      { ...request(), model: model({ buttons: Array.from({ length: 5 }, () => ({ action: 'pause' as const, label: 'Pause' })) }) },
      { ...request(), model: model({ recent: { heading: 'Recent', empty: 'None', steps: Array.from({ length: 4 }, () => ({ text: 'Step' })) } }) },
      // The cursor and pin switches are part of every card.
      { ...request(), model: { ...model(), cursor: undefined } },
      { ...request(), model: model({ cursor: { label: 'Show agent cursors on the page', checked: 'yes' as never } }) },
      { ...request(), model: { ...model(), pin: undefined } },
      { ...request(), model: model({ pin: { label: 'Pin live status below the toolbar', checked: 1 as never } }) }
    ]
    for (const value of bad) expect(() => parseAgentCardShowRequest(value)).toThrow(TypeError)
    // A long reason is allowed, within its own limit.
    expect(parseAgentCardShowRequest({ ...request(), model: model({ reason: { heading: 'Why', text: 'r'.repeat(2_000) } }) }).model.reason?.text).toHaveLength(2_000)
    expect(() => parseAgentCardShowRequest({ ...request(), model: model({ reason: { heading: 'Why', text: 'r'.repeat(2_001) } }) })).toThrow(TypeError)
    // Answers sit with the reason, at most three, each with the key of what it answers.
    const answers = [{ action: 'hand-back' as const, label: 'Done, hand back', key: 'attention-1' }, { action: 'dismiss' as const, label: 'Dismiss', key: 'attention-1' }]
    expect(parseAgentCardShowRequest({ ...request(), model: model({ reason: { heading: 'Why', text: 'Log in.', answers } }) }).model.reason?.answers).toEqual(answers)
    for (const wrong of [
      [...answers, ...answers],
      [{ ...answers[0], key: 'not a key' }],
      [{ ...answers[0], key: 'k'.repeat(129) }],
      [{ ...answers[0], action: 'resolve' }]
    ]) expect(() => parseAgentCardShowRequest({ ...request(), model: model({ reason: { heading: 'Why', text: 'Log in.', answers: wrong as never } }) })).toThrow(TypeError)
  })

  it('accepts a decision answered in the card only within its bounds', () => {
    const decision = {
      id: 'decision-1',
      key: 'decision-1_revision-1',
      plan: { heading: 'What it will do', steps: [{ text: 'd'.repeat(512), detail: 'Irreversible · https://shop.example' }], more: '+2 more, shown in the workspace' },
      check: { id: 'check-1', text: 'Hronaut checked this page.', confirm: 'I looked at the page as it is now.' },
      field: { label: 'Reason (optional)', required: false, toggle: 'Reject…', send: { action: 'answer-reject' as const, label: 'Reject', key: 'decision-1_revision-1' } },
      status: { text: 'That didn’t go through.', alert: true },
      busy: true
    }
    const answers = [{ action: 'answer-resolve' as const, label: 'Looks good', key: 'decision-1_revision-1', needsCheck: true }]
    const withDecision = (value: unknown) => ({ ...request(), model: model({ reason: { heading: 'Why', text: 'Look.', answers, decision: value as never } }) })
    expect(parseAgentCardShowRequest(withDecision(decision)).model.reason).toEqual({ heading: 'Why', text: 'Look.', answers, decision })
    const step = decision.plan.steps[0]!
    for (const wrong of [
      { ...decision, id: 'not an id' },
      { ...decision, key: undefined },
      { ...decision, plan: { heading: 'What', steps: [] } },
      { ...decision, plan: { heading: 'What', steps: Array.from({ length: 5 }, () => step) } },
      { ...decision, plan: { heading: 'What', steps: [{ ...step, text: 'd'.repeat(513) }] } },
      { ...decision, check: { id: 'check-1', text: 'Checked' } },
      // A tick confirms one reading, named by its id.
      { ...decision, check: { ...decision.check, id: undefined } },
      { ...decision, plan: { ...decision.plan, more: '' } },
      // A field sends only an answer, and only for the decision it belongs to.
      { ...decision, field: { ...decision.field, send: { ...decision.field.send, action: 'take-over' } } },
      { ...decision, field: { ...decision.field, send: { ...decision.field.send, key: 'decision-2_revision-1' } } },
      { ...decision, field: { ...decision.field, required: 'no' } },
      { ...decision, status: { text: 'Sent', alert: 'yes' } },
      { ...decision, busy: 1 }
    ]) expect(() => parseAgentCardShowRequest(withDecision(wrong)), JSON.stringify(wrong).slice(0, 80)).toThrow(TypeError)
    expect(() => parseAgentCardShowRequest({ ...request(), model: model({ reason: { heading: 'Why', text: 'Look.', answers: [{ ...answers[0]!, needsCheck: 'yes' as never }] } }) })).toThrow(TypeError)
  })

  it('carries a note only with an answer to a decision, cleaned as main takes it', () => {
    expect(parseAgentCardViewMessage({ cardId: 2, kind: 'action', action: 'answer-reject', key: 'decision-1_revision-1', note: ' Wrong\u202E total\r\nfix it\t ' }))
      .toEqual({ cardId: 2, kind: 'action', action: 'answer-reject', key: 'decision-1_revision-1', note: 'Wrong total\nfix it' })
    expect(parseAgentCardViewMessage({ cardId: 2, kind: 'action', action: 'answer-resolve', key: 'decision-1_revision-1', note: '   ' }))
      .toEqual({ cardId: 2, kind: 'action', action: 'answer-resolve', key: 'decision-1_revision-1' })
    // A tick carries the decision's key and nothing else.
    expect(parseAgentCardViewMessage({ cardId: 2, kind: 'action', action: 'answer-check', key: 'decision-1_revision-1' }))
      .toEqual({ cardId: 2, kind: 'action', action: 'answer-check', key: 'decision-1_revision-1' })
    for (const wrong of [
      { cardId: 2, kind: 'action', action: 'answer-check', key: 'decision-1_revision-1', note: 'Looked' },
      { cardId: 2, kind: 'action', action: 'hand-back', key: 'attention-1', note: 'Done' },
      { cardId: 2, kind: 'action', action: 'take-over', note: 'Hi' },
      { cardId: 2, kind: 'action', action: 'answer-reject', key: 'decision-1_revision-1', note: 'n'.repeat(1_001) },
      { cardId: 2, kind: 'action', action: 'answer-reject', key: 'decision-1_revision-1', note: 42 }
    ]) expect(parseAgentCardViewMessage(wrong)).toBeNull()
  })

  it('reads only well-formed measurements and view messages', () => {
    expect(parseAgentCardMeasurement({ cardId: 2, revision: 3, width: 320, height: 240 })).toEqual({ cardId: 2, revision: 3, width: 320, height: 240 })
    expect(parseAgentCardMeasurement({ cardId: 2, revision: 0, width: 320, height: 240 })).toBeNull()
    expect(parseAgentCardMeasurement({ cardId: 2, revision: 1, width: 0, height: 240 })).toBeNull()
    expect(parseAgentCardViewMessage({ cardId: 2, kind: 'action', action: 'take-over' })).toEqual({ cardId: 2, kind: 'action', action: 'take-over' })
    expect(parseAgentCardViewMessage({ cardId: 2, kind: 'close', reason: 'escape' })).toEqual({ cardId: 2, kind: 'close', reason: 'escape' })
    // Only main decides that focus left the card or that the view was lost.
    expect(parseAgentCardViewMessage({ cardId: 2, kind: 'close', reason: 'blur' })).toBeNull()
    expect(parseAgentCardViewMessage({ cardId: 2, kind: 'close', reason: 'lost' })).toBeNull()
    expect(parseAgentCardViewMessage({ cardId: 2, kind: 'action', action: 'navigate' })).toBeNull()
    expect(parseAgentCardViewMessage({ cardId: 2, kind: 'action', action: 'hand-back', key: 'attention-1' })).toEqual({ cardId: 2, kind: 'action', action: 'hand-back', key: 'attention-1' })
    expect(parseAgentCardViewMessage({ cardId: 2, kind: 'action', action: 'hand-back', key: '<script>' })).toBeNull()
  })

  it('places the card under its avatar, inside the window, and above it only when that side fits', () => {
    const area = { width: 1000, height: 700 }
    expect(placeAgentCard({ x: 600, y: 8, width: 32, height: 32 }, { width: 320, height: 300 }, area, 4, 8)).toEqual({ x: 456, y: 44, width: 320, height: 300 })
    // Near the right edge it stays inside the window.
    expect(placeAgentCard({ x: 960, y: 8, width: 32, height: 32 }, { width: 320, height: 300 }, area, 4, 8).x).toBe(672)
    // A toolbar at the bottom: above it.
    expect(placeAgentCard({ x: 600, y: 660, width: 32, height: 32 }, { width: 320, height: 300 }, area, 4, 8)).toMatchObject({ y: 356, height: 300 })
    // Above, a larger gap keeps the card's shadow room off the avatar.
    expect(placeAgentCard({ x: 600, y: 660, width: 32, height: 32 }, { width: 320, height: 300 }, area, 4, 8, 12)).toMatchObject({ y: 348, height: 300 })
    // A short window: below, as tall as the room there; the card scrolls.
    expect(placeAgentCard({ x: 600, y: 8, width: 32, height: 32 }, { width: 320, height: 300 }, { width: 1000, height: 200 }, 4, 8)).toMatchObject({ y: 44, height: 148 })
  })
})

function fakeSurface() {
  let focused = false
  const surface = {
    send: vi.fn(),
    setZoomFactor: vi.fn(),
    setBounds: vi.fn(),
    present: vi.fn(),
    withdraw: vi.fn(() => { focused = false }),
    focus: vi.fn(() => { focused = true }),
    isFocused: () => focused,
    isDestroyed: () => false,
    blur: () => { focused = false }
  } satisfies AgentCardSurface & { blur: () => void }
  return surface
}

function harness() {
  const surface = fakeSurface()
  let resolveSurface!: (value: AgentCardSurface) => void
  let pending = new Promise<AgentCardSurface>((resolve) => { resolveSurface = resolve })
  let focusOwner: unknown = 'shell'
  const ports = {
    surface: vi.fn(() => pending),
    windowSize: vi.fn<() => { width: number; height: number } | null>(() => ({ width: 1000, height: 700 })),
    emit: vi.fn(),
    focusShell: vi.fn(),
    openChanged: vi.fn(),
    focusOwner: () => focusOwner
  }
  const overlay = new AgentCardOverlay(ports)
  return {
    surface,
    ports,
    overlay,
    focus(owner: unknown) { focusOwner = owner },
    async load() {
      resolveSurface(surface)
      pending = Promise.resolve(surface)
      await Promise.resolve()
      await Promise.resolve()
    },
    lastState: () => surface.send.mock.calls.at(-1)?.[0] as { cardId: number; revision: number }
  }
}

describe('agent card overlay', () => {
  it('shows a card once measured, focused and placed under its avatar, and follows its updates', async () => {
    const { overlay, surface, ports, load, lastState } = harness()
    overlay.show(request(1), 1)
    await load()
    const first = lastState()
    expect(first).toMatchObject({ cardId: 1, theme: 'light' })
    // Nothing shows before the view laid the card out.
    expect(surface.present).not.toHaveBeenCalled()
    overlay.measured({ cardId: 1, revision: first.revision, width: 320, height: 300 })
    // 12 px of shadow room at the sides and below, 4 px above: the view starts at the avatar's lower edge.
    expect(surface.setBounds).toHaveBeenCalledWith({ x: 444, y: 40, width: 344, height: 316 })
    expect(surface.present).toHaveBeenCalledOnce()
    expect(surface.focus).toHaveBeenCalledOnce()
    expect(ports.openChanged).toHaveBeenCalledWith(true)

    // An update of the open card keeps its focus and does not open it again.
    overlay.show(request(1, { model: model({ stateLabel: 'Idle' }) }), 1)
    await Promise.resolve()
    const update = lastState()
    // The view's report for the earlier revision is stale.
    overlay.measured({ cardId: 1, revision: first.revision, width: 320, height: 200 })
    expect(surface.present).toHaveBeenCalledOnce()
    overlay.measured({ cardId: 1, revision: update.revision, width: 320, height: 200 })
    expect(surface.present).toHaveBeenCalledTimes(2)
    expect(surface.focus).toHaveBeenCalledOnce()
    expect(ports.openChanged).toHaveBeenCalledOnce()
  })

  it('keeps focus in the card when an update puts its view back on top', async () => {
    const { overlay, surface, load, lastState } = harness()
    overlay.show(request(1), 1)
    await load()
    overlay.measured({ cardId: 1, revision: lastState().revision, width: 320, height: 300 })
    overlay.show(request(1, { model: model({ stateLabel: 'Idle' }) }), 1)
    await Promise.resolve()
    // A tooltip shown meanwhile was above it; adding the view back on top drops its focus.
    surface.present.mockImplementationOnce(() => { surface.blur(); overlay.blurred() })
    overlay.measured({ cardId: 1, revision: lastState().revision, width: 320, height: 200 })
    await Promise.resolve()
    expect(surface.focus).toHaveBeenCalledTimes(2)
    expect(overlay.openCardId).toBe(1)
  })

  it('does not appear or take focus once the user moved on while it was loading', async () => {
    const { overlay, surface, ports, load, lastState, focus } = harness()
    overlay.show(request(1), 1)
    focus('page')
    await load()
    overlay.measured({ cardId: 1, revision: lastState().revision, width: 320, height: 300 })
    expect(surface.present).not.toHaveBeenCalled()
    expect(surface.focus).not.toHaveBeenCalled()
    expect(ports.emit).toHaveBeenCalledWith({ cardId: 1, kind: 'closed', reason: 'blur' })
    expect(ports.openChanged).not.toHaveBeenCalled()
  })

  it('closes whatever is open and tells the shell when it sent a card outside the contract', async () => {
    const { overlay, ports, load, lastState } = harness()
    overlay.refused(4)
    expect(ports.emit).toHaveBeenLastCalledWith({ cardId: 4, kind: 'closed', reason: 'lost' })
    overlay.show(request(5), 1)
    await load()
    overlay.measured({ cardId: 5, revision: lastState().revision, width: 320, height: 300 })
    overlay.refused(6)
    expect(ports.emit.mock.calls.slice(-2)).toEqual([[{ cardId: 5, kind: 'closed', reason: 'lost' }], [{ cardId: 6, kind: 'closed', reason: 'lost' }]])
    expect(overlay.openCardId).toBeUndefined()
    // A later update of the refused card does not open it.
    overlay.show(request(6), 1)
    expect(overlay.openCardId).toBeUndefined()
  })

  it('never sizes the view beyond the largest card the view may draw', async () => {
    const { overlay, surface, load, lastState } = harness()
    overlay.show(request(1), 2)
    await load()
    overlay.measured({ cardId: 1, revision: lastState().revision, width: 5_000, height: 5_000 })
    const bounds = surface.setBounds.mock.calls[0]![0] as { width: number; height: number }
    expect(bounds.width).toBeLessThanOrEqual((340 + 24) * 2)
    expect(bounds.height).toBeLessThanOrEqual(700)
  })

  it('drops a card replaced before its view loaded', async () => {
    const { overlay, surface, load } = harness()
    overlay.show(request(1), 1)
    overlay.show(request(2), 1)
    await load()
    await Promise.resolve()
    expect(surface.send.mock.calls.map(([state]) => (state as { cardId: number }).cardId)).toEqual([2])
  })

  it('reports actions of the open card only, and closes on Esc with focus back in the shell', async () => {
    const { overlay, ports, load, lastState } = harness()
    overlay.show(request(1), 1)
    await load()
    // Not presented yet: a message cannot come from a card the user saw.
    overlay.received({ cardId: 1, kind: 'action', action: 'take-over' })
    expect(ports.emit).not.toHaveBeenCalled()
    overlay.measured({ cardId: 1, revision: lastState().revision, width: 320, height: 300 })
    overlay.received({ cardId: 7, kind: 'action', action: 'take-over' })
    overlay.received({ cardId: 1, kind: 'action', action: 'pause' })
    overlay.received({ cardId: 1, kind: 'action', action: 'hand-back', key: 'attention-1' })
    overlay.received({ cardId: 1, kind: 'action', action: 'answer-reject', key: 'decision-1_revision-1', note: 'Wrong total' })
    expect(ports.emit.mock.calls).toEqual([
      [{ cardId: 1, kind: 'action', action: 'pause' }],
      [{ cardId: 1, kind: 'action', action: 'hand-back', key: 'attention-1' }],
      [{ cardId: 1, kind: 'action', action: 'answer-reject', key: 'decision-1_revision-1', note: 'Wrong total' }]
    ])
    overlay.received({ cardId: 1, kind: 'close', reason: 'escape' })
    expect(ports.emit).toHaveBeenLastCalledWith({ cardId: 1, kind: 'closed', reason: 'escape' })
    expect(ports.focusShell).toHaveBeenCalledOnce()
    expect(ports.openChanged).toHaveBeenLastCalledWith(false)
    expect(overlay.openCardId).toBeUndefined()
  })

  it('closes when focus leaves the card, but not for a restack that keeps it', async () => {
    const { overlay, surface, ports, load, lastState } = harness()
    overlay.show(request(1), 1)
    await load()
    overlay.measured({ cardId: 1, revision: lastState().revision, width: 320, height: 300 })
    // Putting the view back on top can drop its focus for a moment; it gets it back.
    surface.present.mockImplementationOnce(() => { surface.blur(); overlay.blurred() })
    overlay.restack()
    await Promise.resolve()
    expect(surface.focus).toHaveBeenCalledTimes(2)
    expect(overlay.openCardId).toBe(1)
    // A click elsewhere takes focus for good.
    surface.blur()
    overlay.blurred()
    await Promise.resolve()
    expect(ports.emit).toHaveBeenLastCalledWith({ cardId: 1, kind: 'closed', reason: 'blur' })
    // Focus moved on its own; main does not move it again.
    expect(ports.focusShell).not.toHaveBeenCalled()
  })

  it('never opens a card again once it closed, was hidden or was replaced, until the shell reloads', async () => {
    const { overlay, surface, ports, load, lastState } = harness()
    overlay.show(request(1), 1)
    await load()
    overlay.measured({ cardId: 1, revision: lastState().revision, width: 320, height: 300 })
    surface.blur()
    overlay.blurred()
    await Promise.resolve()
    expect(ports.emit).toHaveBeenLastCalledWith({ cardId: 1, kind: 'closed', reason: 'blur' })
    // An update the shell sent before it heard of the closing arrives late.
    overlay.show(request(1, { model: model({ stateLabel: 'Idle' }) }), 1)
    await Promise.resolve()
    expect(overlay.openCardId).toBeUndefined()
    expect(surface.send).toHaveBeenCalledOnce()

    overlay.show(request(2), 1)
    overlay.show(request(3), 1)
    overlay.show(request(2), 1)
    expect(overlay.openCardId).toBe(3)
    overlay.hide(3)
    overlay.show(request(3), 1)
    expect(overlay.openCardId).toBeUndefined()

    // A new shell document numbers its cards from 1 again.
    overlay.shellReset()
    overlay.show(request(1), 1)
    expect(overlay.openCardId).toBe(1)
  })

  it('returns focus to the shell when the shell closes a focused card, and ignores another card id', async () => {
    const { overlay, surface, ports, load, lastState } = harness()
    overlay.show(request(1), 1)
    await load()
    overlay.measured({ cardId: 1, revision: lastState().revision, width: 320, height: 300 })
    overlay.hide(2)
    expect(surface.withdraw).not.toHaveBeenCalled()
    overlay.hide(1)
    expect(surface.withdraw).toHaveBeenCalledOnce()
    expect(ports.focusShell).toHaveBeenCalledOnce()
    expect(ports.emit).not.toHaveBeenCalled()
  })

  it('closes when the window changes or the view is lost, and stays closed once disposed', async () => {
    const { overlay, ports, load, lastState } = harness()
    overlay.show(request(1), 1)
    await load()
    overlay.measured({ cardId: 1, revision: lastState().revision, width: 320, height: 300 })
    overlay.dismiss()
    expect(ports.emit).toHaveBeenLastCalledWith({ cardId: 1, kind: 'closed', reason: 'blur' })
    overlay.show(request(2), 1)
    await Promise.resolve()
    overlay.surfaceLost()
    expect(ports.emit).toHaveBeenLastCalledWith({ cardId: 2, kind: 'closed', reason: 'lost' })
    overlay.dispose()
    overlay.show(request(3), 1)
    expect(overlay.openCardId).toBeUndefined()
  })
})

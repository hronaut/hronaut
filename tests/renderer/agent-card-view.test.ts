import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentCardMeasurement, AgentCardModel, AgentCardState, AgentCardViewMessage } from '../../src/shared/agent-card.js'

function model(overrides: Partial<AgentCardModel> = {}): AgentCardModel {
  return {
    label: 'Claude Code, agent details',
    name: '<img src=x onerror=alert(1)>',
    initial: 'C',
    color: '#2aa198',
    state: 'working',
    stateLabel: 'Working',
    subtitle: 'Connected over MCP · Checkout',
    now: { heading: 'Now', text: 'Reading the page' },
    recent: { heading: 'Recent steps', empty: 'No finished steps yet', steps: [{ text: 'Clicked on the page, failed', failed: true }] },
    follow: { label: 'Follow agents in all workspaces', checked: false },
    cursor: { label: 'Show agent cursors on the page', checked: true },
    pin: { label: 'Pin live status below the toolbar', checked: false },
    buttons: [{ action: 'pause', label: 'Pause on this tab' }, { action: 'take-over', label: 'Take over' }],
    closeLabel: 'Close',
    ...overrides
  }
}

async function loadView() {
  vi.resetModules()
  document.body.innerHTML = '<div id="agent-card-root"></div>'
  let render!: (state: AgentCardState) => void
  const sent: AgentCardViewMessage[] = []
  const measured: AgentCardMeasurement[] = []
  window.hronautAgentCardView = {
    onState: (listener) => { render = listener; return () => undefined },
    measured: (measurement) => { measured.push(measurement) },
    send: (message) => { sent.push(message) }
  }
  await import('../../src/renderer/src/agent-card.js')
  const card = () => document.querySelector<HTMLElement>('.agent-card')!
  const control = (selector: string) => document.querySelector<HTMLElement>(selector)!
  return { render: (state: AgentCardState) => render(state), sent, measured, card, control }
}

function key(name: string, shiftKey = false): void {
  document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: name, shiftKey, bubbles: true, cancelable: true }))
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('agent card view', () => {
  it('renders the card as text, focuses the card itself when it opens and moves in only then', async () => {
    const view = await loadView()
    view.render({ cardId: 1, revision: 1, theme: 'dark', model: model() })
    const card = view.card()
    expect(card.getAttribute('role')).toBe('dialog')
    expect(card.getAttribute('aria-label')).toBe('Claude Code, agent details')
    expect(document.querySelector('img')).toBeNull()
    expect(card.querySelector('.agent-card-name')?.textContent).toBe('<img src=x onerror=alert(1)>')
    expect(card.querySelector('.agent-card-step')?.getAttribute('data-failed')).toBe('true')
    expect(document.activeElement).toBe(card)
    expect(card.dataset.opening).toBe('true')
    expect(document.documentElement.dataset.theme).toBe('dark')
    // An update of the same card replaces it without moving in again.
    view.render({ cardId: 1, revision: 2, theme: 'dark', model: model({ stateLabel: 'Idle' }) })
    expect(view.card().dataset.opening).toBeUndefined()
    expect(document.activeElement).toBe(view.card())
  })

  it('keeps focus on the control that was used when it changes, Pause to Resume or the switch', async () => {
    const view = await loadView()
    view.render({ cardId: 1, revision: 1, theme: 'light', model: model() })
    view.control('[data-action="pause"]').focus()
    view.control('[data-action="pause"]').click()
    expect(view.sent).toEqual([{ cardId: 1, kind: 'action', action: 'pause' }])
    view.render({ cardId: 1, revision: 2, theme: 'light', model: model({ buttons: [{ action: 'resume', label: 'Resume on this tab' }, { action: 'take-over', label: 'Take over' }] }) })
    expect((document.activeElement as HTMLElement).dataset.action).toBe('resume')
    view.control('[data-action="follow-on"]').focus()
    view.render({ cardId: 1, revision: 3, theme: 'light', model: model({ follow: { label: 'Follow agents in all workspaces', checked: true } }) })
    expect((document.activeElement as HTMLElement).dataset.action).toBe('follow-off')
    expect(view.control('[data-action="follow-off"]').getAttribute('aria-checked')).toBe('true')
  })

  it('turns agent cursors off and on from their switch, keeping focus on it', async () => {
    const view = await loadView()
    view.render({ cardId: 2, revision: 1, theme: 'light', model: model() })
    const cursor = view.control('[data-action="cursor-off"]')
    expect(cursor.getAttribute('role')).toBe('switch')
    expect(cursor.getAttribute('aria-checked')).toBe('true')
    expect(cursor.textContent).toContain('Show agent cursors on the page')
    cursor.focus()
    cursor.click()
    expect(view.sent).toEqual([{ cardId: 2, kind: 'action', action: 'cursor-off' }])
    view.render({ cardId: 2, revision: 2, theme: 'light', model: model({ cursor: { label: 'Show agent cursors on the page', checked: false } }) })
    expect((document.activeElement as HTMLElement).dataset.action).toBe('cursor-on')
    expect(view.control('[data-action="cursor-on"]').getAttribute('aria-checked')).toBe('false')
  })

  it('pins and unpins the live status from its switch, keeping focus on it', async () => {
    const view = await loadView()
    view.render({ cardId: 3, revision: 1, theme: 'light', model: model() })
    const pin = view.control('[data-action="pin-on"]')
    expect(pin.getAttribute('role')).toBe('switch')
    expect(pin.getAttribute('aria-checked')).toBe('false')
    expect(pin.textContent).toContain('Pin live status below the toolbar')
    pin.focus()
    pin.click()
    expect(view.sent).toEqual([{ cardId: 3, kind: 'action', action: 'pin-on' }])
    view.render({ cardId: 3, revision: 2, theme: 'light', model: model({ pin: { label: 'Pin live status below the toolbar', checked: true } }) })
    expect((document.activeElement as HTMLElement).dataset.action).toBe('pin-off')
    expect(view.control('[data-action="pin-off"]').getAttribute('aria-checked')).toBe('true')
  })

  it('shows the answers under the reason and sends each with the key of the request it answers', async () => {
    const view = await loadView()
    view.render({ cardId: 4, revision: 1, theme: 'light', model: model({
      state: 'needs-you',
      reason: { heading: 'Why it needs you', text: 'Log in, then hand back.', answers: [
        { action: 'hand-back', label: 'Done, hand back', key: 'attention-1' },
        { action: 'dismiss', label: 'Dismiss', key: 'attention-1' }
      ] }
    }) })
    const answers = [...document.querySelectorAll<HTMLButtonElement>('.agent-card-answers button')]
    expect(answers.map((button) => [button.textContent, button.closest('section')?.getAttribute('aria-labelledby')])).toEqual([
      ['Done, hand back', 'agent-card-reason'],
      ['Dismiss', 'agent-card-reason']
    ])
    answers[0].click()
    expect(view.sent.at(-1)).toEqual({ cardId: 4, kind: 'action', action: 'hand-back', key: 'attention-1' })
    view.control('[data-action="pause"]').click()
    expect(view.sent.at(-1)).toEqual({ cardId: 4, kind: 'action', action: 'pause' })
  })

  it('closes on Esc and keeps Tab inside the card', async () => {
    const view = await loadView()
    view.render({ cardId: 3, revision: 1, theme: 'light', model: model() })
    key('Tab')
    expect(document.activeElement).toBe(view.control('.agent-card-close'))
    key('Tab', true)
    expect((document.activeElement as HTMLElement).dataset.action).toBe('take-over')
    key('Tab')
    expect(document.activeElement).toBe(view.control('.agent-card-close'))
    key('Escape')
    expect(view.sent.at(-1)).toEqual({ cardId: 3, kind: 'close', reason: 'escape' })
  })

  it('reports each card revision it laid out, and not an earlier one', async () => {
    // The first card can lay out before the font loads; its late report must not follow a newer revision.
    let fontsReady!: () => void
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: new Promise<void>((resolve) => { fontsReady = resolve }) } })
    try {
      const view = await loadView()
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 320, bottom: 200, width: 320, height: 200, toJSON: () => ({}) })
      view.render({ cardId: 1, revision: 1, theme: 'light', model: model() })
      view.render({ cardId: 1, revision: 2, theme: 'light', model: model() })
      fontsReady()
      await Promise.resolve()
      await Promise.resolve()
      expect(view.measured.map(({ revision }) => revision)).toEqual([1, 2])
      expect(view.measured[1]).toMatchObject({ cardId: 1, width: 320, height: 200 })
    } finally {
      vi.restoreAllMocks()
      Reflect.deleteProperty(document, 'fonts')
    }
  })
})

describe('agent card view: answering a decision', () => {
  const check = { id: 'check-1', text: 'Hronaut checked this page: Earlier action outcome remains unknown.', confirm: 'I reviewed the page and understand that the earlier action may already have taken effect.' }
  const live = () => [...document.querySelectorAll<HTMLElement>('.agent-card-live')].map((region) => [region.getAttribute('role'), region.textContent])

  function reviewPage(decision: Partial<NonNullable<NonNullable<AgentCardModel['reason']>['decision']>> = {}): AgentCardModel {
    return model({
      state: 'needs-you',
      reason: {
        heading: 'Why it needs you',
        text: 'Look at the page, then hand it back or tell the agent what to fix.',
        answers: [
          { action: 'answer-resolve', label: 'Looks good, hand back', key: 'decision-1_r1', needsCheck: true },
          { action: 'review-decision', label: 'Open in workspace', key: 'attention-1' }
        ],
        decision: {
          id: 'decision-1',
          key: 'decision-1_r1',
          check,
          field: { label: 'What should the agent fix? (optional)', required: false, toggle: 'Something wrong?', send: { action: 'answer-reject', label: 'Send back', key: 'decision-1_r1' } },
          ...decision
        }
      }
    })
  }

  function provideInput(decision: Partial<NonNullable<NonNullable<AgentCardModel['reason']>['decision']>> = {}): AgentCardModel {
    return model({
      state: 'needs-you',
      reason: {
        heading: 'Why it needs you',
        text: 'The agent needs your answer to carry on.',
        answers: [{ action: 'review-decision', label: 'Open in workspace', key: 'attention-2' }],
        decision: {
          id: 'decision-2',
          key: 'decision-2_r1',
          check,
          field: { label: 'Your answer for the agent', required: true, send: { action: 'answer-resolve', label: 'Send', key: 'decision-2_r1', needsCheck: true } },
          ...decision
        }
      }
    })
  }

  function type(field: HTMLTextAreaElement, value: string): void {
    field.value = value
    field.dispatchEvent(new Event('input', { bubbles: true }))
  }

  function tick(box: HTMLInputElement, checked = true): void {
    box.checked = checked
    box.dispatchEvent(new Event('change', { bubbles: true }))
  }

  it('waits for the page check before handing back, tells the shell when you tick, and sends the decision key without a note', async () => {
    const view = await loadView()
    view.render({ cardId: 5, revision: 1, theme: 'light', model: reviewPage() })
    expect(view.control('.agent-card-check-text').textContent).toBe(check.text)
    const looksGood = view.control('[data-action="answer-resolve"]') as HTMLButtonElement
    expect(looksGood.disabled).toBe(true)
    const box = view.control('[data-focus="answer-check"]') as HTMLInputElement
    expect(box.closest('label')?.textContent).toBe(check.confirm)
    tick(box)
    // Hronaut reads the page when you confirm it; the tick names the reading it confirms.
    expect(view.sent).toEqual([{ cardId: 5, kind: 'action', action: 'answer-check', key: 'check-1' }])
    tick(box, false)
    expect(looksGood.disabled).toBe(true)
    expect(view.sent).toHaveLength(1)
    tick(box)
    expect(looksGood.disabled).toBe(false)
    looksGood.click()
    expect(view.sent.at(-1)).toEqual({ cardId: 5, kind: 'action', action: 'answer-resolve', key: 'decision-1_r1' })
    // A check with nothing to confirm leaves the answer free.
    view.render({ cardId: 5, revision: 2, theme: 'light', model: reviewPage({ check: undefined }) })
    expect((view.control('[data-action="answer-resolve"]') as HTMLButtonElement).disabled).toBe(false)
  })

  it('opens the field on demand, sends the note with the rejection and measures the card again', async () => {
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
    let height = 300
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ x: 0, y: 0, left: 0, top: 0, right: 320, bottom: height, width: 320, height, toJSON: () => ({}) }))
    try {
      const view = await loadView()
      view.render({ cardId: 6, revision: 1, theme: 'light', model: reviewPage() })
      const field = view.control('.agent-card-field')
      expect(field.hidden).toBe(true)
      // A closed field is out of the Tab order: Tab from inside it goes where it would from outside the card.
      ;(view.control('[data-focus="answer-note"]') as HTMLTextAreaElement).focus()
      key('Tab')
      expect(document.activeElement).toBe(view.control('.agent-card-close'))
      const toggle = view.control('[data-focus="answer-toggle"]')
      expect(toggle.getAttribute('aria-expanded')).toBe('false')
      expect(toggle.getAttribute('aria-controls')).toBe(field.id)
      height = 420
      toggle.click()
      expect(field.hidden).toBe(false)
      expect(toggle.getAttribute('aria-expanded')).toBe('true')
      const textarea = view.control('[data-focus="answer-note"]') as HTMLTextAreaElement
      expect(document.activeElement).toBe(textarea)
      expect(textarea.maxLength).toBe(1_000)
      expect(view.measured.at(-1)).toMatchObject({ cardId: 6, revision: 1, height: 420 })
      type(textarea, '  The total is wrong.  ')
      view.control('[data-focus="answer-send"]').click()
      expect(view.sent.at(-1)).toEqual({ cardId: 6, kind: 'action', action: 'answer-reject', key: 'decision-1_r1', note: 'The total is wrong.' })
    } finally {
      rect.mockRestore()
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    }
  })

  it('keeps what you typed, the caret and focus through an update, and waits while sending', async () => {
    const view = await loadView()
    view.render({ cardId: 7, revision: 1, theme: 'light', model: provideInput() })
    const textarea = view.control('[data-focus="answer-note"]') as HTMLTextAreaElement
    const send = () => view.control('[data-focus="answer-send"]') as HTMLButtonElement
    expect(textarea.required).toBe(true)
    // You type, then confirm the page and send: the check comes after the field.
    const box = view.control('.agent-card-check')
    expect(textarea.closest('.agent-card-field')!.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // The answer is required, and so is the check; spaces and invisible characters are no answer.
    expect(send().disabled).toBe(true)
    tick(view.control('[data-focus="answer-check"]') as HTMLInputElement)
    expect(send().disabled).toBe(true)
    type(textarea, ' \u200B\u202E ')
    expect(send().disabled).toBe(true)
    textarea.focus()
    type(textarea, 'Use the second address')
    textarea.setSelectionRange(4, 10)
    expect(send().disabled).toBe(false)
    view.render({ cardId: 7, revision: 2, theme: 'light', model: provideInput({ status: { text: 'Sending…' }, busy: true }) })
    const kept = view.control('[data-focus="answer-note"]') as HTMLTextAreaElement
    expect(kept).not.toBe(textarea)
    expect(kept.value).toBe('Use the second address')
    expect(document.activeElement).toBe(kept)
    expect([kept.selectionStart, kept.selectionEnd]).toEqual([4, 10])
    expect(kept.readOnly).toBe(true)
    expect(send().disabled).toBe(true)
    expect((view.control('[data-focus="answer-check"]') as HTMLInputElement).checked).toBe(true)
    expect(view.control('.agent-card-status').textContent).toBe('Sending…')
    expect(live()).toEqual([['status', 'Sending…'], ['alert', '']])
    // A failure keeps the text; a new reading of the page, even one that reads the same, asks for a new tick.
    view.render({ cardId: 7, revision: 3, theme: 'light', model: provideInput({ status: { text: 'Confirm the page again', alert: true }, check: { ...check, id: 'check-2' } }) })
    expect((view.control('[data-focus="answer-note"]') as HTMLTextAreaElement).value).toBe('Use the second address')
    expect((view.control('[data-focus="answer-check"]') as HTMLInputElement).checked).toBe(false)
    expect(send().disabled).toBe(true)
    expect(live()).toEqual([['status', ''], ['alert', 'Confirm the page again']])
    // An update that changes nothing announces nothing again; a card that briefly lacks the decision keeps the draft.
    const alert = document.querySelector('.agent-card-live[role="alert"]')!.firstChild
    view.render({ cardId: 7, revision: 4, theme: 'light', model: provideInput({ status: { text: 'Confirm the page again', alert: true }, check: { ...check, id: 'check-2' } }) })
    expect(document.querySelector('.agent-card-live[role="alert"]')!.firstChild).toBe(alert)
    view.render({ cardId: 7, revision: 5, theme: 'light', model: model({ state: 'needs-you', reason: { heading: 'Why it needs you', text: 'Needs you.' } }) })
    view.render({ cardId: 7, revision: 6, theme: 'light', model: provideInput() })
    expect((view.control('[data-focus="answer-note"]') as HTMLTextAreaElement).value).toBe('Use the second address')
  })

  it('sends with Ctrl or Cmd and Enter, leaves Enter alone for a new line, and leaves keys to an input method', async () => {
    const view = await loadView()
    view.render({ cardId: 8, revision: 1, theme: 'light', model: provideInput({ check: undefined }) })
    const textarea = view.control('[data-focus="answer-note"]') as HTMLTextAreaElement
    textarea.focus()
    const press = (init: KeyboardEventInit) => {
      const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
      textarea.dispatchEvent(event)
      return event
    }
    // Nothing typed: Ctrl+Enter sends nothing.
    press({ key: 'Enter', ctrlKey: true })
    expect(view.sent).toEqual([])
    type(textarea, 'Blue')
    expect(press({ key: 'Enter' }).defaultPrevented).toBe(false)
    expect(press({ key: 'Escape', isComposing: true }).defaultPrevented).toBe(false)
    expect(press({ key: 'Enter', ctrlKey: true, isComposing: true }).defaultPrevented).toBe(false)
    expect(view.sent).toEqual([])
    press({ key: 'Enter', metaKey: true })
    expect(view.sent).toEqual([{ cardId: 8, kind: 'action', action: 'answer-resolve', key: 'decision-2_r1', note: 'Blue' }])
    press({ key: 'Escape' })
    expect(view.sent.at(-1)).toEqual({ cardId: 8, kind: 'close', reason: 'escape' })
  })

  it('starts a new card with nothing typed or ticked', async () => {
    const view = await loadView()
    view.render({ cardId: 9, revision: 1, theme: 'light', model: provideInput() })
    type(view.control('[data-focus="answer-note"]') as HTMLTextAreaElement, 'Secret answer')
    tick(view.control('[data-focus="answer-check"]') as HTMLInputElement)
    view.render({ cardId: 10, revision: 1, theme: 'light', model: provideInput() })
    expect((view.control('[data-focus="answer-note"]') as HTMLTextAreaElement).value).toBe('')
    expect((view.control('[data-focus="answer-check"]') as HTMLInputElement).checked).toBe(false)
  })

  it('shows what an approval would do, offers no approval there and keeps Tab inside the card', async () => {
    const view = await loadView()
    view.render({ cardId: 11, revision: 1, theme: 'light', model: model({
      state: 'needs-you',
      buttons: [],
      reason: {
        heading: 'Why it needs you',
        text: 'The agent wants your approval before it acts.',
        answers: [{ action: 'review-decision', label: 'Review and approve', key: 'attention-3' }],
        decision: {
          id: 'decision-3',
          key: 'decision-3_r1',
          plan: { heading: 'What it will do', steps: [{ text: 'Submit the order', detail: 'Irreversible · https://shop.example' }], more: '+2 more, shown in the workspace' },
          field: { label: 'Reason for the agent (optional)', required: false, toggle: 'Reject…', send: { action: 'answer-reject', label: 'Reject', key: 'decision-3_r1' } }
        }
      }
    }) })
    expect([...document.querySelectorAll('.agent-card-plan li')].map((item) => item.textContent)).toEqual(['Submit the orderIrreversible · https://shop.example'])
    expect(view.control('.agent-card-plan-more').textContent).toBe('+2 more, shown in the workspace')
    expect(document.querySelector('[data-action="answer-resolve"]')).toBeNull()
    expect([...document.querySelectorAll('.agent-card-answers button')].map((button) => button.textContent)).toEqual(['Review and approve', 'Reject…'])
    expect(view.control('.agent-card-field').hidden).toBe(true)
    view.control('[data-action="pin-on"]').focus()
    key('Tab')
    expect(document.activeElement).toBe(view.control('.agent-card-close'))
    key('Tab', true)
    expect((document.activeElement as HTMLElement).dataset.action).toBe('pin-on')
  })
})

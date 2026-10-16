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
    view.control('.agent-card-switch').focus()
    view.render({ cardId: 1, revision: 3, theme: 'light', model: model({ follow: { label: 'Follow agents in all workspaces', checked: true } }) })
    expect((document.activeElement as HTMLElement).dataset.action).toBe('follow-off')
    expect(view.control('.agent-card-switch').getAttribute('aria-checked')).toBe('true')
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
    const view = await loadView()
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 320, bottom: 200, width: 320, height: 200, toJSON: () => ({}) })
    view.render({ cardId: 1, revision: 1, theme: 'light', model: model() })
    view.render({ cardId: 1, revision: 2, theme: 'light', model: model() })
    expect(view.measured.map(({ revision }) => revision)).toEqual([1, 2])
    expect(view.measured[1]).toMatchObject({ cardId: 1, width: 320, height: 200 })
    vi.restoreAllMocks()
  })
})

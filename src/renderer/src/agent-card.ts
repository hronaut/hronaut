import './agent-card.css'
import type { AgentCardMeasurement, AgentCardModel, AgentCardState, AgentCardViewMessage } from '../../shared/agent-card.js'

interface HronautAgentCardViewApi {
  onState(listener: (state: AgentCardState) => void): () => void
  measured(measurement: AgentCardMeasurement): void
  send(message: AgentCardViewMessage): void
}

declare global {
  interface Window {
    hronautAgentCardView: HronautAgentCardViewApi
  }
}

const SVG = 'http://www.w3.org/2000/svg'
const ROBOT = 'M10 3h4v2h3a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3h3V3Zm-1 8a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm6 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM8 20h8v1H8v-1Z'
const DONE = 'M5 12.5l4.5 4.5L19 7.5'
const FAILED = 'M7 7l10 10M17 7L7 17'
const CLOSE = 'M6 6l12 12M18 6L6 18'
const TOGGLED: Record<string, string> = { pause: 'resume', resume: 'pause', 'follow-on': 'follow-off', 'follow-off': 'follow-on' }

const root = document.querySelector<HTMLElement>('#agent-card-root')
if (!root) throw new Error('Agent card root is unavailable')
const cardRoot = root
const api = window.hronautAgentCardView

let currentCardId = 0
let currentRevision = 0
let reported = ''

function icon(path: string, filled = false): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  const shape = document.createElementNS(SVG, 'path')
  shape.setAttribute('d', path)
  if (filled) svg.setAttribute('fill', 'currentColor')
  svg.append(shape)
  return svg
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function send(message: AgentCardViewMessage): void {
  api.send(message)
}

function section(id: string, heading: string, ...content: HTMLElement[]): HTMLElement {
  const node = element('section', 'agent-card-section')
  const title = element('h3', 'agent-card-heading', heading)
  title.id = id
  node.setAttribute('aria-labelledby', id)
  node.append(title, ...content)
  return node
}

function build(cardId: number, model: AgentCardModel): HTMLElement {
  const card = element('div', 'agent-card')
  card.dataset.state = model.state
  card.tabIndex = -1
  card.setAttribute('role', 'dialog')
  card.setAttribute('aria-label', model.label)
  card.style.setProperty('--agent-color', model.color)

  const header = element('div', 'agent-card-header')
  const avatar = element('span', 'agent-card-avatar', model.initial || undefined)
  avatar.setAttribute('aria-hidden', 'true')
  if (!model.initial) avatar.append(icon(ROBOT, true))
  const title = element('div', 'agent-card-title')
  title.append(
    element('h2', 'agent-card-name', model.name),
    element('p', 'agent-card-subtitle', model.subtitle),
    element('span', 'agent-card-state', model.stateLabel)
  )
  const close = element('button', 'agent-card-close')
  close.type = 'button'
  close.setAttribute('aria-label', model.closeLabel)
  close.append(icon(CLOSE))
  close.addEventListener('click', () => send({ cardId, kind: 'close', reason: 'escape' }))
  header.append(avatar, title, close)
  card.append(header)

  if (model.reason) card.append(section('agent-card-reason', model.reason.heading, element('p', 'agent-card-reason', model.reason.text)))
  card.append(section('agent-card-now', model.now.heading, element('p', 'agent-card-now', model.now.text)))
  if (model.recent.steps.length) {
    const list = element('ul', 'agent-card-steps')
    for (const step of model.recent.steps) {
      const item = element('li', 'agent-card-step')
      item.dataset.failed = String(step.failed === true)
      item.append(icon(step.failed ? FAILED : DONE), element('span', '', step.text))
      list.append(item)
    }
    card.append(section('agent-card-recent', model.recent.heading, list))
  } else {
    card.append(section('agent-card-recent', model.recent.heading, element('p', 'agent-card-subtitle', model.recent.empty)))
  }

  const follow = element('button', 'agent-card-switch')
  follow.type = 'button'
  follow.setAttribute('role', 'switch')
  follow.setAttribute('aria-checked', String(model.follow.checked))
  follow.disabled = model.follow.disabled === true
  follow.dataset.action = model.follow.checked ? 'follow-off' : 'follow-on'
  follow.append(element('span', '', model.follow.label), element('span', 'agent-card-switch-track'))
  follow.addEventListener('click', () => send({ cardId, kind: 'action', action: model.follow.checked ? 'follow-off' : 'follow-on' }))
  card.append(follow)

  if (model.buttons.length) {
    const actions = element('div', 'agent-card-actions')
    for (const button of model.buttons) {
      const node = element('button', 'agent-card-button', button.label)
      node.type = 'button'
      node.dataset.action = button.action
      node.disabled = button.disabled === true
      node.addEventListener('click', () => send({ cardId, kind: 'action', action: button.action }))
      actions.append(node)
    }
    card.append(actions)
  }
  return card
}

function focusable(): HTMLElement[] {
  return [...cardRoot.querySelectorAll<HTMLElement>('button:not(:disabled)')]
}

function measure(cardId: number, revision: number, card: HTMLElement): void {
  if (cardId !== currentCardId || revision !== currentRevision) return
  // Reading the box performs layout while the view is still hidden; a hidden view may never produce a frame.
  // The card's natural height: main sizes the view to it, or smaller in a short window, where the card scrolls.
  const box = card.getBoundingClientRect()
  const border = card.offsetHeight - card.clientHeight
  const measurement = { cardId, revision, width: Math.ceil(box.width), height: Math.ceil(Math.max(box.height, card.scrollHeight + border)) }
  const key = `${cardId}:${revision}:${measurement.width}x${measurement.height}`
  if (key === reported || measurement.width < 1 || measurement.height < 1) return
  reported = key
  api.measured(measurement)
}

function render(state: AgentCardState): void {
  const opening = state.cardId !== currentCardId
  const previous = cardRoot.querySelector<HTMLElement>('.agent-card')
  const active = document.activeElement as HTMLElement | null
  // An update keeps keyboard focus on the same control, found by its action, and the card's scroll.
  const focusedAction = opening ? undefined : active?.dataset.action
  const focusedClose = !opening && active?.classList.contains('agent-card-close') === true
  const focusedCard = !opening && active === previous
  const scrollTop = opening ? 0 : previous?.scrollTop ?? 0
  currentCardId = state.cardId
  currentRevision = state.revision
  document.documentElement.dataset.theme = state.theme
  const card = build(state.cardId, state.model)
  if (opening) card.dataset.opening = 'true'
  cardRoot.replaceChildren(card)
  card.scrollTop = scrollTop
  const controls = focusable()
  // Pause becomes Resume and the switch flips when used; focus stays on the control that changed.
  const partner = focusedAction && TOGGLED[focusedAction]
  const restored = focusedClose
    ? card.querySelector<HTMLElement>('.agent-card-close')
    : controls.find((control) => focusedAction !== undefined && (control.dataset.action === focusedAction || control.dataset.action === partner))
  // A new card, or one whose focused control went away, focuses the card itself.
  ;(restored ?? (opening || focusedCard || focusedAction !== undefined || focusedClose ? card : undefined))?.focus({ preventScroll: true })
  measure(state.cardId, state.revision, card)
  // The first card can lay out before the bundled font has loaded; report its final size too.
  void document.fonts?.ready.then(() => measure(state.cardId, state.revision, card))
}

document.addEventListener('keydown', (event) => {
  if (!currentCardId) return
  if (event.key === 'Escape') {
    event.preventDefault()
    send({ cardId: currentCardId, kind: 'close', reason: 'escape' })
    return
  }
  if (event.key !== 'Tab') return
  // Focus stays in the card; Tab past either end wraps around.
  const controls = focusable()
  if (!controls.length) return
  const index = controls.indexOf(document.activeElement as HTMLElement)
  const next = event.shiftKey
    ? (index <= 0 ? controls.at(-1) : undefined)
    : (index === -1 || index === controls.length - 1 ? controls[0] : undefined)
  if (next) {
    event.preventDefault()
    next.focus()
  }
})

api.onState(render)

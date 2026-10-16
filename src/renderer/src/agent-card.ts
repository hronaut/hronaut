import './agent-card.css'
import {
  isAgentCardAnswerAction,
  type AgentCardAction,
  type AgentCardButton,
  type AgentCardDecision,
  type AgentCardMeasurement,
  type AgentCardModel,
  type AgentCardState,
  type AgentCardSwitch,
  type AgentCardViewMessage
} from '../../shared/agent-card.js'
import { HUMAN_WAITING_NOTE_LIMIT, normalizeHumanWaitingNote } from '../../shared/human-waiting.js'

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
const TOGGLED: Record<string, string> = {
  pause: 'resume', resume: 'pause', 'follow-on': 'follow-off', 'follow-off': 'follow-on', 'cursor-on': 'cursor-off', 'cursor-off': 'cursor-on'
}

const root = document.querySelector<HTMLElement>('#agent-card-root')
if (!root) throw new Error('Agent card root is unavailable')
const cardRoot = root
const api = window.hronautAgentCardView

let currentCardId = 0
let currentRevision = 0
let reported = ''

/** What you did in a decision's answer before sending it: the box ticked for one reading of the page, the field opened, what you typed. */
interface Draft {
  checkedFor?: string
  open: boolean
  note: string
}
// Kept per decision while its card is open, so an update of the card keeps them; a new card starts empty.
const drafts = new Map<string, Draft>()

// How sending goes is announced from two regions that outlive the card's updates, so each change is read once.
function liveRegion(role: 'status' | 'alert'): HTMLElement {
  const node = element('div', 'agent-card-live')
  node.setAttribute('role', role)
  document.body.append(node)
  return node
}
const politeRegion = liveRegion('status')
const alertRegion = liveRegion('alert')

function announce(status?: { text: string; alert?: boolean }): void {
  const [region, other] = status?.alert ? [alertRegion, politeRegion] : [politeRegion, alertRegion]
  if (other.textContent) other.textContent = ''
  const text = status?.text ?? ''
  if (region.textContent !== text) region.textContent = text
}

function draftOf(id: string): Draft {
  let draft = drafts.get(id)
  if (!draft) {
    draft = { open: false, note: '' }
    drafts.set(id, draft)
  }
  return draft
}

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

/** A switch that sends the action that flips it. */
function toggle(cardId: number, model: AgentCardSwitch, action: AgentCardAction): HTMLElement {
  const node = element('button', 'agent-card-switch')
  node.type = 'button'
  node.setAttribute('role', 'switch')
  node.setAttribute('aria-checked', String(model.checked))
  node.disabled = model.disabled === true
  node.dataset.action = action
  node.append(element('span', '', model.label), element('span', 'agent-card-switch-track'))
  node.addEventListener('click', () => send({ cardId, kind: 'action', action }))
  return node
}

function actionButton(cardId: number, button: AgentCardButton, note?: () => string | undefined): HTMLButtonElement {
  const node = element('button', 'agent-card-button', button.label)
  node.type = 'button'
  node.dataset.action = button.action
  node.disabled = button.disabled === true
  node.addEventListener('click', () => {
    const text = note?.()
    send({ cardId, kind: 'action', action: button.action, ...(button.key ? { key: button.key } : {}), ...(text ? { note: text } : {}) })
  })
  return node
}

function actions(cardId: number, className: string, buttons: readonly AgentCardButton[]): HTMLElement {
  const row = element('div', className)
  row.append(...buttons.map((button) => actionButton(cardId, button)))
  return row
}

/**
 * A decision's answers: what an approval would do, the page check to confirm, the field for your
 * note or answer, and how sending went. Buttons that need the check or an answer wait for them.
 */
function decisionContent(cardId: number, decision: AgentCardDecision, answers: readonly AgentCardButton[], measureAgain: () => void): HTMLElement[] {
  const draft = draftOf(decision.id)
  const content: HTMLElement[] = []
  // Answer buttons that wait for the check, or for an answer typed into the field.
  const gated: Array<{ node: HTMLButtonElement; button: AgentCardButton; typed?: boolean }> = []

  if (decision.plan) {
    const list = element('ol', 'agent-card-plan')
    for (const step of decision.plan.steps) {
      const item = element('li', '')
      item.append(element('span', 'agent-card-plan-text', step.text))
      if (step.detail) item.append(element('span', 'agent-card-plan-detail', step.detail))
      list.append(item)
    }
    const plan = element('div', 'agent-card-plan-section')
    plan.append(element('p', 'agent-card-plan-heading', decision.plan.heading), list)
    if (decision.plan.more) plan.append(element('p', 'agent-card-plan-more', decision.plan.more))
    content.push(plan)
  }

  let checkbox: HTMLInputElement | undefined
  let checkBox: HTMLElement | undefined
  if (decision.check) {
    const check = decision.check
    const box = element('div', 'agent-card-check')
    const label = element('label', 'agent-card-check-label')
    checkbox = element('input', '')
    checkbox.type = 'checkbox'
    checkbox.dataset.focus = 'answer-check'
    // A tick confirms the page as Hronaut read it this time, and asks it to read the page again at that moment;
    // a new reading needs a new tick.
    checkbox.checked = draft.checkedFor === check.id
    checkbox.disabled = decision.busy === true
    checkbox.addEventListener('change', () => {
      draft.checkedFor = checkbox!.checked ? check.id : undefined
      // The tick names the reading it confirms, so a newer one the card has not shown yet is not confirmed by it.
      if (checkbox!.checked) send({ cardId, kind: 'action', action: 'answer-check', key: check.id })
      update()
    })
    label.append(checkbox, element('span', '', check.confirm))
    box.append(element('p', 'agent-card-check-text', check.text), label)
    checkBox = box
  }

  const field = decision.field
  const row = element('div', 'agent-card-answers')
  let fieldBox: HTMLElement | undefined
  let toggleNode: HTMLButtonElement | undefined
  if (field) {
    fieldBox = element('div', 'agent-card-field')
    fieldBox.id = 'agent-card-answer-field'
    const label = element('label', 'agent-card-field-label')
    const textarea = element('textarea', 'agent-card-note')
    textarea.dataset.focus = 'answer-note'
    textarea.rows = 3
    textarea.maxLength = HUMAN_WAITING_NOTE_LIMIT
    textarea.value = draft.note
    textarea.readOnly = decision.busy === true
    textarea.required = field.required
    textarea.addEventListener('input', () => {
      draft.note = textarea.value
      update()
    })
    label.append(element('span', '', field.label), textarea)
    fieldBox.append(label)
    const sendNode = actionButton(cardId, field.send, () => draft.note.trim() || undefined)
    sendNode.dataset.focus = 'answer-send'
    gated.push({ node: sendNode, button: field.send, typed: true })
    if (field.toggle) {
      // A field opened on demand keeps its own send button, under what you type.
      const box = fieldBox
      sendNode.classList.add('agent-card-field-send')
      box.append(sendNode)
      box.hidden = !draft.open
      const toggle = element('button', 'agent-card-button', field.toggle)
      toggle.type = 'button'
      toggle.dataset.focus = 'answer-toggle'
      toggle.setAttribute('aria-expanded', String(draft.open))
      toggle.setAttribute('aria-controls', box.id)
      toggle.disabled = decision.busy === true
      toggle.addEventListener('click', () => {
        draft.open = !draft.open
        box.hidden = !draft.open
        toggle.setAttribute('aria-expanded', String(draft.open))
        if (draft.open) {
          textarea.focus({ preventScroll: true })
          box.scrollIntoView({ block: 'nearest' })
        }
        measureAgain()
      })
      toggleNode = toggle
    } else {
      // An answer you type goes first.
      row.append(sendNode)
    }
  }
  for (const button of answers) {
    const node = actionButton(cardId, button)
    if (isAgentCardAnswerAction(button.action)) gated.push({ node, button })
    row.append(node)
  }
  if (toggleNode) row.append(toggleNode)
  // A field you always answer in comes before the check, so you type, then confirm the page and send;
  // one opened on demand comes after the answers.
  if (fieldBox && !field?.toggle) content.push(fieldBox)
  if (checkBox) content.push(checkBox)
  content.push(row)
  if (fieldBox && field?.toggle) content.push(fieldBox)

  if (decision.status) {
    // Shown here; screen readers hear it from the live regions.
    const status = element('p', 'agent-card-status', decision.status.text)
    if (decision.status.alert) status.dataset.alert = 'true'
    content.push(status)
  }

  function update(): void {
    const checked = !decision.check || checkbox?.checked === true
    for (const { node, button, typed } of gated) {
      node.disabled = button.disabled === true || decision.busy === true
        || (button.needsCheck === true && !checked)
        // An answer of only spaces or invisible characters is no answer.
        || (typed === true && decision.field?.required === true && !normalizeHumanWaitingNote(draft.note))
    }
  }
  update()
  return content
}

function build(cardId: number, model: AgentCardModel, measureAgain: () => void): HTMLElement {
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

  if (model.reason) {
    const why = element('p', 'agent-card-reason', model.reason.text)
    const answers = model.reason.answers ?? []
    card.append(model.reason.decision
      ? section('agent-card-reason', model.reason.heading, why, ...decisionContent(cardId, model.reason.decision, answers, measureAgain))
      : answers.length
        ? section('agent-card-reason', model.reason.heading, why, actions(cardId, 'agent-card-answers', answers))
        : section('agent-card-reason', model.reason.heading, why))
  }
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

  card.append(
    toggle(cardId, model.follow, model.follow.checked ? 'follow-off' : 'follow-on'),
    toggle(cardId, model.cursor, model.cursor.checked ? 'cursor-off' : 'cursor-on')
  )

  if (model.buttons.length) card.append(actions(cardId, 'agent-card-actions', model.buttons))
  return card
}

function focusable(): HTMLElement[] {
  // Controls inside a field that is closed are not in the way.
  return [...cardRoot.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled)')]
    .filter((control) => !control.closest('[hidden]'))
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
  // An update keeps keyboard focus on the same control, found by its action or its part of an answer,
  // with the text selection in a field, and the card's scroll.
  const focusedAction = opening ? undefined : active?.dataset.focus ? undefined : active?.dataset.action
  const focusedPart = opening ? undefined : active?.dataset.focus
  const selection = active instanceof HTMLTextAreaElement
    ? { start: active.selectionStart, end: active.selectionEnd, direction: active.selectionDirection, scrollTop: active.scrollTop }
    : undefined
  const focusedClose = !opening && active?.classList.contains('agent-card-close') === true
  const focusedCard = !opening && active === previous
  const scrollTop = opening ? 0 : previous?.scrollTop ?? 0
  if (opening) {
    drafts.clear()
    announce()
  }
  currentCardId = state.cardId
  currentRevision = state.revision
  // Another decision in the card drops the draft of the one before; a card briefly without it keeps the draft.
  const decisionId = state.model.reason?.decision?.id
  if (decisionId) for (const id of [...drafts.keys()]) if (id !== decisionId) drafts.delete(id)
  announce(state.model.reason?.decision?.status)
  document.documentElement.dataset.theme = state.theme
  const card = build(state.cardId, state.model, () => measure(state.cardId, state.revision, card))
  if (opening) card.dataset.opening = 'true'
  cardRoot.replaceChildren(card)
  card.scrollTop = scrollTop
  const controls = focusable()
  // Pause becomes Resume and the switch flips when used; focus stays on the control that changed.
  const partner = focusedAction && TOGGLED[focusedAction]
  const restored = focusedClose
    ? card.querySelector<HTMLElement>('.agent-card-close')
    : focusedPart !== undefined
      ? controls.find((control) => control.dataset.focus === focusedPart)
      : controls.find((control) => focusedAction !== undefined && (control.dataset.action === focusedAction || control.dataset.action === partner))
  // A new card, or one whose focused control went away, focuses the card itself.
  ;(restored ?? (opening || focusedCard || focusedAction !== undefined || focusedPart !== undefined || focusedClose ? card : undefined))?.focus({ preventScroll: true })
  if (selection && restored instanceof HTMLTextAreaElement) {
    restored.setSelectionRange(selection.start, selection.end, selection.direction ?? undefined)
    restored.scrollTop = selection.scrollTop
  }
  measure(state.cardId, state.revision, card)
  // The first card can lay out before the bundled font has loaded; report its final size too.
  void document.fonts?.ready.then(() => measure(state.cardId, state.revision, card))
}

document.addEventListener('keydown', (event) => {
  if (!currentCardId) return
  // Keys that compose text with an input method belong to it.
  if (event.isComposing) return
  const target = event.target
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && target instanceof HTMLTextAreaElement && cardRoot.contains(target)) {
    // Ctrl or Cmd with Enter sends what you typed; Enter alone starts a new line.
    event.preventDefault()
    const sendButton = cardRoot.querySelector<HTMLButtonElement>('[data-focus="answer-send"]')
    if (sendButton && !sendButton.disabled) sendButton.click()
    return
  }
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

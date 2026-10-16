import type { AgentPresenceState } from './agent-presence.js'
import { normalizeHumanWaitingNote } from './human-waiting.js'
import type { ShellTooltipRect } from './shell-tooltip.js'
import { isResolvedThemeName, type ResolvedThemeName } from './theme.js'

/**
 * The agent card opens under an agent's avatar in the toolbar. The shell builds its content in
 * the user's language; main draws it in a transparent view above the page and returns the
 * user's choices to the shell, which carries them out with the shell's own browser API.
 */
export const AGENT_CARD_ACTIONS = [
  'show-tab', 'pause', 'resume', 'take-over', 'follow-on', 'follow-off', 'cursor-on', 'cursor-off', 'hand-back', 'dismiss', 'review-decision',
  'answer-check', 'answer-resolve', 'answer-reject'
] as const
export type AgentCardAction = typeof AGENT_CARD_ACTIONS[number]
/** Answers to an agent's decision; only these carry the person's note. */
export type AgentCardAnswerAction = 'answer-resolve' | 'answer-reject'
export function isAgentCardAnswerAction(value: unknown): value is AgentCardAnswerAction {
  return value === 'answer-resolve' || value === 'answer-reject'
}

/** Why the card closed: Esc, focus moved away (an outside click or another window), an action, or the view was lost. */
export const AGENT_CARD_CLOSE_REASONS = ['escape', 'blur', 'action', 'lost'] as const
export type AgentCardCloseReason = typeof AGENT_CARD_CLOSE_REASONS[number]

/** Largest card main draws, in CSS pixels; the view caps its own box to the same size. */
export const AGENT_CARD_MAX_WIDTH = 340
export const AGENT_CARD_MAX_HEIGHT = 480
/** Transparent room the card view keeps around the card for its shadow, in CSS pixels. */
export const AGENT_CARD_SHADOW_ROOM = 12
export const AGENT_CARD_GAP = 4
/** Room above the card in its view: the shadow falls downward, and the view must not cover the avatar's lower edge. */
export const AGENT_CARD_TOP_ROOM = 4
export const AGENT_CARD_EDGE = 8
export const AGENT_CARD_TEXT_LIMIT = 300
export const AGENT_CARD_REASON_LIMIT = 2_000
export const AGENT_CARD_INITIAL_LIMIT = 8
/** An approval step's description, as long as a waiting decision keeps it. */
export const AGENT_CARD_PLAN_TEXT_LIMIT = 512
const TEXT_LIMIT = AGENT_CARD_TEXT_LIMIT
const REASON_LIMIT = AGENT_CARD_REASON_LIMIT
const RECENT_LIMIT = 3
const BUTTON_LIMIT = 4
const ANSWER_LIMIT = 3
const PLAN_LIMIT = 4

export interface AgentCardStep {
  text: string
  failed?: boolean
}

export interface AgentCardButton {
  action: AgentCardAction
  label: string
  disabled?: boolean
  /** Names what an answer answers, such as the request's id; it comes back with the action. */
  key?: string
  /** Stays disabled until the person ticks the decision's check box. */
  needsCheck?: boolean
}

/** A decision the agent left for you, answered in the card. */
export interface AgentCardDecision {
  /** Names the decision; the card keeps what you typed for it while it stays open. */
  id: string
  /** Names the decision and the revision the card shows; its answers carry it back. */
  key: string
  /** What an approval would do: the agent's own bounded description of each step, and how many more there are. */
  plan?: { heading: string; steps: Array<{ text: string; detail?: string }>; more?: string }
  /**
   * What Hronaut found when it checked the workspace, and the box the person ticks to confirm the page as it is.
   * Ticking it sends `answer-check`; its id names this reading, and a new reading needs a new tick.
   */
  check?: { id: string; text: string; confirm: string }
  /** A field for the person's note or answer, sent with one answer. With a toggle it opens on demand. */
  field?: { label: string; required: boolean; toggle?: string; send: AgentCardButton & { action: AgentCardAnswerAction } }
  /** Sending, or why an answer did not go. */
  status?: { text: string; alert?: boolean }
  /** An answer is on its way; the card's answers wait. */
  busy?: boolean
}

export interface AgentCardSwitch {
  label: string
  checked: boolean
  disabled?: boolean
}

/** Everything the card shows, already in the user's language. */
export interface AgentCardModel {
  /** The dialog's accessible name. */
  label: string
  name: string
  /** The avatar's letter; empty draws a robot. */
  initial: string
  /** The avatar color, as #rrggbb. */
  color: string
  state: AgentPresenceState
  stateLabel: string
  /** For example "Connected over MCP · Checkout". */
  subtitle: string
  /** Why the agent asked for you, while it needs you, and how you can answer it here. */
  reason?: { heading: string; text: string; answers?: AgentCardButton[]; decision?: AgentCardDecision }
  now: { heading: string; text: string }
  recent: { heading: string; steps: AgentCardStep[]; empty: string }
  follow: AgentCardSwitch
  /** Whether agents' cursors are drawn on the page. */
  cursor: AgentCardSwitch
  buttons: AgentCardButton[]
  closeLabel: string
}

/** Sent by the shell: the avatar's box in its viewport, in CSS pixels. The same cardId updates an open card. */
export interface AgentCardShowRequest {
  cardId: number
  anchor: ShellTooltipRect
  theme: ResolvedThemeName
  model: AgentCardModel
}

/** Sent to the card view, which reports its measured size for the same card and revision. A new cardId takes focus. */
export interface AgentCardState {
  cardId: number
  revision: number
  theme: ResolvedThemeName
  model: AgentCardModel
}

export interface AgentCardMeasurement {
  cardId: number
  revision: number
  width: number
  height: number
}

/** Sent by the card view. */
export type AgentCardViewMessage =
  | { cardId: number; kind: 'action'; action: AgentCardAction; key?: string; note?: string }
  | { cardId: number; kind: 'close'; reason: 'escape' }

/** Sent to the shell. An answer to a decision can carry the person's note. */
export type AgentCardEvent =
  | { cardId: number; kind: 'action'; action: AgentCardAction; key?: string; note?: string }
  | { cardId: number; kind: 'closed'; reason: AgentCardCloseReason }

export interface HronautAgentCardApi {
  show(request: AgentCardShowRequest): void
  hide(cardId: number): void
  onEvent(listener: (event: AgentCardEvent) => void): () => void
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function text(value: unknown, limit = TEXT_LIMIT, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > limit || (!allowEmpty && value.trim().length === 0)) throw new TypeError('Invalid agent card text')
  return value
}

function finite(value: unknown, minimum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > 100_000) throw new TypeError('Invalid agent card number')
  return value
}

const KEY = /^[\w-]{1,128}$/u

function validKey(value: unknown): value is string {
  return typeof value === 'string' && KEY.test(value)
}

export function validAgentCardId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0
}

export function isAgentCardAction(value: unknown): value is AgentCardAction {
  return (AGENT_CARD_ACTIONS as readonly unknown[]).includes(value)
}

function section(value: unknown, limit = TEXT_LIMIT): { heading: string; text: string } {
  const source = record(value)
  if (!source) throw new TypeError('Invalid agent card section')
  return { heading: text(source.heading), text: text(source.text, limit) }
}

function button(entry: unknown): AgentCardButton {
  const source = record(entry)
  if (!source || !isAgentCardAction(source.action) || (source.disabled !== undefined && typeof source.disabled !== 'boolean')
    || (source.key !== undefined && !validKey(source.key)) || (source.needsCheck !== undefined && typeof source.needsCheck !== 'boolean')) {
    throw new TypeError('Invalid agent card button')
  }
  return {
    action: source.action,
    label: text(source.label),
    ...(source.disabled ? { disabled: true } : {}),
    ...(source.key === undefined ? {} : { key: source.key }),
    ...(source.needsCheck ? { needsCheck: true } : {})
  }
}

function buttons(value: unknown, limit: number): AgentCardButton[] {
  if (!Array.isArray(value) || value.length > limit) throw new TypeError('Invalid agent card buttons')
  return value.map(button)
}

function decisionSection(value: unknown): AgentCardDecision {
  const source = record(value)
  if (!source || !validKey(source.id) || !validKey(source.key) || (source.busy !== undefined && typeof source.busy !== 'boolean')) {
    throw new TypeError('Invalid agent card decision')
  }
  const plan = source.plan === undefined ? undefined : record(source.plan)
  if (source.plan !== undefined && (!plan || !Array.isArray(plan.steps) || plan.steps.length < 1 || plan.steps.length > PLAN_LIMIT)) {
    throw new TypeError('Invalid agent card plan')
  }
  const check = source.check === undefined ? undefined : record(source.check)
  if (source.check !== undefined && (!check || !validKey(check.id))) throw new TypeError('Invalid agent card check')
  const field = source.field === undefined ? undefined : record(source.field)
  if (source.field !== undefined && (!field || typeof field.required !== 'boolean')) throw new TypeError('Invalid agent card field')
  const send = field ? button(field.send) : undefined
  if (send && (!isAgentCardAnswerAction(send.action) || send.key !== source.key)) throw new TypeError('Invalid agent card field')
  const status = source.status === undefined ? undefined : record(source.status)
  if (source.status !== undefined && (!status || (status.alert !== undefined && typeof status.alert !== 'boolean'))) throw new TypeError('Invalid agent card status')
  return {
    id: source.id,
    key: source.key,
    ...(plan ? {
      plan: {
        heading: text(plan.heading),
        steps: (plan.steps as unknown[]).map((entry) => {
          const step = record(entry)
          if (!step) throw new TypeError('Invalid agent card plan')
          return { text: text(step.text, AGENT_CARD_PLAN_TEXT_LIMIT), ...(step.detail === undefined ? {} : { detail: text(step.detail) }) }
        }),
        ...(plan.more === undefined ? {} : { more: text(plan.more) })
      }
    } : {}),
    ...(check ? { check: { id: check.id as string, text: text(check.text), confirm: text(check.confirm) } } : {}),
    ...(field && send ? {
      field: {
        label: text(field.label),
        required: field.required as boolean,
        ...(field.toggle === undefined ? {} : { toggle: text(field.toggle) }),
        send: { ...send, action: send.action as AgentCardAnswerAction }
      }
    } : {}),
    ...(status ? { status: { text: text(status.text), ...(status.alert ? { alert: true } : {}) } } : {}),
    ...(source.busy ? { busy: true } : {})
  }
}

function reasonSection(value: unknown): NonNullable<AgentCardModel['reason']> {
  const answers = record(value)?.answers
  const decision = record(value)?.decision
  return {
    ...section(value, REASON_LIMIT),
    ...(answers === undefined ? {} : { answers: buttons(answers, ANSWER_LIMIT) }),
    ...(decision === undefined ? {} : { decision: decisionSection(decision) })
  }
}

function cardSwitch(value: unknown, name: string): AgentCardSwitch {
  const source = record(value)
  if (!source || typeof source.checked !== 'boolean' || (source.disabled !== undefined && typeof source.disabled !== 'boolean')) {
    throw new TypeError(`Invalid agent card ${name} switch`)
  }
  return { label: text(source.label), checked: source.checked, ...(source.disabled ? { disabled: true } : {}) }
}

export function parseAgentCardModel(value: unknown): AgentCardModel {
  const source = record(value)
  if (!source) throw new TypeError('Invalid agent card')
  const state = source.state
  if (state !== 'idle' && state !== 'working' && state !== 'needs-you') throw new TypeError('Invalid agent card state')
  const color = text(source.color, 7)
  if (!/^#[0-9a-f]{6}$/iu.test(color)) throw new TypeError('Invalid agent card color')
  const recent = record(source.recent)
  if (!recent || !Array.isArray(recent.steps) || recent.steps.length > RECENT_LIMIT) throw new TypeError('Invalid agent card steps')
  return {
    label: text(source.label),
    name: text(source.name),
    initial: text(source.initial, AGENT_CARD_INITIAL_LIMIT, true),
    color,
    state,
    stateLabel: text(source.stateLabel),
    subtitle: text(source.subtitle),
    ...(source.reason === undefined ? {} : { reason: reasonSection(source.reason) }),
    now: section(source.now),
    recent: {
      heading: text(recent.heading),
      empty: text(recent.empty),
      steps: recent.steps.map((value) => {
        const step = record(value)
        if (!step || (step.failed !== undefined && typeof step.failed !== 'boolean')) throw new TypeError('Invalid agent card step')
        return { text: text(step.text), ...(step.failed ? { failed: true } : {}) }
      })
    },
    follow: cardSwitch(source.follow, 'follow'),
    cursor: cardSwitch(source.cursor, 'cursor'),
    buttons: buttons(source.buttons, BUTTON_LIMIT),
    closeLabel: text(source.closeLabel)
  }
}

export function parseAgentCardShowRequest(value: unknown): AgentCardShowRequest {
  const source = record(value)
  const anchor = record(source?.anchor)
  if (!source || !validAgentCardId(source.cardId) || !anchor || !isResolvedThemeName(source.theme)) throw new TypeError('Invalid agent card request')
  return {
    cardId: source.cardId,
    anchor: { x: finite(anchor.x, -100_000), y: finite(anchor.y, -100_000), width: finite(anchor.width, 0), height: finite(anchor.height, 0) },
    theme: source.theme,
    model: parseAgentCardModel(source.model)
  }
}

export function parseAgentCardMeasurement(value: unknown): AgentCardMeasurement | null {
  const source = record(value)
  if (!source || !validAgentCardId(source.cardId) || !Number.isSafeInteger(source.revision) || (source.revision as number) < 1) return null
  try {
    return { cardId: source.cardId, revision: source.revision as number, width: finite(source.width, 1), height: finite(source.height, 1) }
  } catch {
    return null
  }
}

export function parseAgentCardViewMessage(value: unknown): AgentCardViewMessage | null {
  const source = record(value)
  if (!source || !validAgentCardId(source.cardId)) return null
  if (source.kind === 'action' && isAgentCardAction(source.action) && (source.key === undefined || validKey(source.key))) {
    // Only an answer to a decision carries a note, cleaned and bounded as main will take it.
    const note = source.note === undefined ? undefined : isAgentCardAnswerAction(source.action) ? normalizeHumanWaitingNote(source.note) : null
    if (note === null) return null
    return {
      cardId: source.cardId,
      kind: 'action',
      action: source.action,
      ...(source.key === undefined ? {} : { key: source.key }),
      ...(note === undefined ? {} : { note })
    }
  }
  if (source.kind === 'close' && source.reason === 'escape') return { cardId: source.cardId, kind: 'close', reason: 'escape' }
  return null
}

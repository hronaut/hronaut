import type { AgentPresenceState } from './agent-presence.js'
import type { ShellTooltipRect } from './shell-tooltip.js'
import { isResolvedThemeName, type ResolvedThemeName } from './theme.js'

/**
 * The agent card opens under an agent's avatar in the toolbar. The shell builds its content in
 * the user's language; main draws it in a transparent view above the page and returns the
 * user's choices to the shell, which carries them out with the shell's own browser API.
 */
export const AGENT_CARD_ACTIONS = ['show-tab', 'pause', 'resume', 'take-over', 'follow-on', 'follow-off'] as const
export type AgentCardAction = typeof AGENT_CARD_ACTIONS[number]

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
const TEXT_LIMIT = AGENT_CARD_TEXT_LIMIT
const REASON_LIMIT = AGENT_CARD_REASON_LIMIT
const RECENT_LIMIT = 3
const BUTTON_LIMIT = 4

export interface AgentCardStep {
  text: string
  failed?: boolean
}

export interface AgentCardButton {
  action: AgentCardAction
  label: string
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
  /** Why the agent asked for you, while it needs you. */
  reason?: { heading: string; text: string }
  now: { heading: string; text: string }
  recent: { heading: string; steps: AgentCardStep[]; empty: string }
  follow: { label: string; checked: boolean; disabled?: boolean }
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
  | { cardId: number; kind: 'action'; action: AgentCardAction }
  | { cardId: number; kind: 'close'; reason: 'escape' }

/** Sent to the shell. */
export type AgentCardEvent =
  | { cardId: number; kind: 'action'; action: AgentCardAction }
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

export function parseAgentCardModel(value: unknown): AgentCardModel {
  const source = record(value)
  if (!source) throw new TypeError('Invalid agent card')
  const state = source.state
  if (state !== 'idle' && state !== 'working' && state !== 'needs-you') throw new TypeError('Invalid agent card state')
  const color = text(source.color, 7)
  if (!/^#[0-9a-f]{6}$/iu.test(color)) throw new TypeError('Invalid agent card color')
  const recent = record(source.recent)
  if (!recent || !Array.isArray(recent.steps) || recent.steps.length > RECENT_LIMIT) throw new TypeError('Invalid agent card steps')
  const follow = record(source.follow)
  if (!follow || typeof follow.checked !== 'boolean' || (follow.disabled !== undefined && typeof follow.disabled !== 'boolean')) throw new TypeError('Invalid agent card follow switch')
  if (!Array.isArray(source.buttons) || source.buttons.length > BUTTON_LIMIT) throw new TypeError('Invalid agent card buttons')
  return {
    label: text(source.label),
    name: text(source.name),
    initial: text(source.initial, AGENT_CARD_INITIAL_LIMIT, true),
    color,
    state,
    stateLabel: text(source.stateLabel),
    subtitle: text(source.subtitle),
    ...(source.reason === undefined ? {} : { reason: section(source.reason, REASON_LIMIT) }),
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
    follow: { label: text(follow.label), checked: follow.checked, ...(follow.disabled ? { disabled: true } : {}) },
    buttons: source.buttons.map((value) => {
      const button = record(value)
      if (!button || !isAgentCardAction(button.action) || (button.disabled !== undefined && typeof button.disabled !== 'boolean')) {
        throw new TypeError('Invalid agent card button')
      }
      return { action: button.action, label: text(button.label), ...(button.disabled ? { disabled: true } : {}) }
    }),
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
  if (source.kind === 'action' && isAgentCardAction(source.action)) return { cardId: source.cardId, kind: 'action', action: source.action }
  if (source.kind === 'close' && source.reason === 'escape') return { cardId: source.cardId, kind: 'close', reason: 'escape' }
  return null
}

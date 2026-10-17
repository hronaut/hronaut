import { isResolvedThemeName, type ResolvedThemeName } from './theme.js'

/**
 * The shell's notifications, such as **Tab closed** with **Undo**, show at the bottom of the page area in a
 * transparent native view above the page, where they cover no tab, toolbar command or address field. The shell keeps
 * the toast, its timer and its action; its own copy of the toast stays in the shell's accessibility tree and keyboard
 * order. Main draws the toast in the view, mirrors which of its buttons has keyboard focus in the shell, and returns
 * the person's clicks and hover to the shell. When the view cannot show a toast, main says so and the shell shows its
 * own copy instead.
 */
export const TOAST_OVERLAY_TONES = ['error', 'success', 'info'] as const
export type ToastOverlayTone = typeof TOAST_OVERLAY_TONES[number]
/** A button of the toast that has keyboard focus in the shell, drawn with a focus ring in the view. */
export type ToastOverlayFocus = 'action' | 'dismiss'
/** What the person did in the view: used the action, closed the toast, or moved the pointer onto or off it. */
export type ToastOverlayMessageKind = 'act' | 'dismiss' | 'retain' | 'release'

/** Widest toast main draws, in CSS pixels; narrower when the page area is. */
export const TOAST_OVERLAY_MAX_WIDTH = 560
/** Tallest toast main draws, in CSS pixels; the view caps its own box to the same height. */
export const TOAST_OVERLAY_MAX_HEIGHT = 64
/** Transparent room the view keeps around the toast for its shadow, in CSS pixels. */
export const TOAST_OVERLAY_SHADOW_ROOM = 10
/** Distance from the bottom and sides of the page area, in CSS pixels. */
export const TOAST_OVERLAY_EDGE = 16
/** The narrowest page area a toast still fits in, in CSS pixels. */
export const TOAST_OVERLAY_MIN_WIDTH = 160
const TITLE_LIMIT = 120
const MESSAGE_LIMIT = 1_000
const LABEL_LIMIT = 40

export interface ToastOverlayToast {
  id: number
  tone: ToastOverlayTone
  title: string
  message: string
  /** The toast's button, such as Undo. */
  action?: { label: string }
}

/** What the shell asks main to show; no toast hides the view. */
export interface ToastOverlayRequest {
  toast: ToastOverlayToast | null
  focus: ToastOverlayFocus | null
  theme: ResolvedThemeName
}

/** What main sends the view: the request with the width to lay the toast out at, and a revision for its measurement. */
export interface ToastOverlayState {
  revision: number
  toast: ToastOverlayToast
  focus: ToastOverlayFocus | null
  theme: ResolvedThemeName
  /** CSS pixels, without the shadow room. */
  width: number
}

export interface ToastOverlayMeasurement {
  revision: number
  height: number
}

/** A click or hover in the view, for the toast with this id. */
export interface ToastOverlayMessage {
  id: number
  kind: ToastOverlayMessageKind
}

/**
 * What the shell hears back about the toast with this id: what the person did in the view, that the view shows it, or
 * that the view cannot show it, such as in a page area too narrow for it.
 */
export interface ToastOverlayEvent {
  id: number
  kind: ToastOverlayMessageKind | 'shown' | 'unavailable'
}

export interface HronautToastOverlayApi {
  show(request: ToastOverlayRequest): void
  onEvent(listener: (event: ToastOverlayEvent) => void): () => void
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

export function validToastOverlayId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1
}

function boundedText(value: unknown, limit: number, allowEmpty: boolean): string {
  if (typeof value !== 'string' || value.length > limit || (!allowEmpty && value.trim().length === 0)) {
    throw new TypeError('Invalid toast text')
  }
  return value
}

function parseToast(value: unknown): ToastOverlayToast {
  const source = record(value)
  if (!source || !validToastOverlayId(source.id) || !TOAST_OVERLAY_TONES.includes(source.tone as ToastOverlayTone)) {
    throw new TypeError('Invalid toast')
  }
  const action = source.action === undefined ? undefined : record(source.action)
  if (source.action !== undefined && !action) throw new TypeError('Invalid toast action')
  return {
    id: source.id,
    tone: source.tone as ToastOverlayTone,
    title: boundedText(source.title, TITLE_LIMIT, true),
    message: boundedText(source.message, MESSAGE_LIMIT, true),
    ...(action ? { action: { label: boundedText(action.label, LABEL_LIMIT, false) } } : {})
  }
}

function parseFocus(value: unknown): ToastOverlayFocus | null {
  if (value === null || value === undefined) return null
  if (value === 'action' || value === 'dismiss') return value
  throw new TypeError('Invalid toast focus')
}

/** Only a toast within the shell's own limits is drawn; anything else is refused. */
export function parseToastOverlayRequest(value: unknown): ToastOverlayRequest {
  const source = record(value)
  if (!source || !isResolvedThemeName(source.theme)) throw new TypeError('Invalid toast request')
  const toast = source.toast === null ? null : parseToast(source.toast)
  const focus = parseFocus(source.focus)
  if (focus === 'action' && !toast?.action) throw new TypeError('Invalid toast focus')
  return { toast, focus: toast ? focus : null, theme: source.theme }
}

export function parseToastOverlayMeasurement(value: unknown): ToastOverlayMeasurement | null {
  const source = record(value)
  if (!source || !validToastOverlayId(source.revision)) return null
  const height = source.height
  if (typeof height !== 'number' || !Number.isFinite(height) || height < 1 || height > 10_000) return null
  return { revision: source.revision, height }
}

export function parseToastOverlayMessage(value: unknown): ToastOverlayMessage | null {
  const source = record(value)
  if (!source || !validToastOverlayId(source.id)) return null
  const kind = source.kind
  if (kind !== 'act' && kind !== 'dismiss' && kind !== 'retain' && kind !== 'release') return null
  return { id: source.id, kind }
}

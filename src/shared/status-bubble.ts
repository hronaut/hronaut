import type { ResolvedThemeName } from './theme.js'

/**
 * Chrome's status bubble: while the person points at a link on a page, or a link has keyboard focus, the link's
 * address shows in a small box at the page's bottom left corner. Main draws it in a transparent native view above the
 * page, with Chrome's timings (status_bubble_views.cc): it shows after a short pause, so a sweep across links does not
 * flash it, stays a moment after the pointer leaves the link, and widens to the whole address after the pointer rests
 * on one whose address it had to shorten.
 */
export const STATUS_BUBBLE_SHOW_DELAY_MS = 80
export const STATUS_BUBBLE_HIDE_DELAY_MS = 250
export const STATUS_BUBBLE_EXPAND_DELAY_MS = 1_600
/** How near the pointer comes before the bubble moves to the other corner, out of its way, in CSS pixels. */
export const STATUS_BUBBLE_MOUSE_PADDING = 20
/** Tallest bubble main draws, in CSS pixels; the view keeps its box to one line. */
export const STATUS_BUBBLE_MAX_HEIGHT = 40
/** The part of an address the view gets; the bubble never shows more, even widened. */
export const STATUS_BUBBLE_TEXT_LIMIT = 4_096

/** Which bottom corner of the page the bubble sits in. */
export type StatusBubbleSide = 'left' | 'right'

/**
 * A link's address as the bubble writes it, in parts the view shortens one at a time: the rest first, then the start
 * of the host, which keeps the end of the host, its site, in view.
 */
export interface StatusBubbleText {
  /** `https://`, `file://` or another scheme with its slashes; empty for http, as Chrome writes it. */
  scheme: string
  /** The host and port. */
  host: string
  /** The path, query and fragment, or all of an address with no host, such as `mailto:` or `javascript:`. */
  rest: string
}

/** What main sends the view; it reports its laid-out size for the same id. */
export interface StatusBubbleState {
  id: number
  text: StatusBubbleText
  theme: ResolvedThemeName
  side: StatusBubbleSide
  /** CSS pixels: a third of the page's width, or all of it once widened. */
  maxWidth: number
  /** The page's own corner radius in CSS pixels, which the bubble's corner in the page's corner follows. */
  corner: number
  /** The first state since the bubble was out of sight, which fades in; a change while it shows does not. */
  opening: boolean
}

export interface StatusBubbleMeasurement {
  id: number
  width: number
  height: number
  /** Whether the view had to shorten the address to fit. */
  shortened: boolean
}

function capped(text: string): string {
  return text.length > STATUS_BUBBLE_TEXT_LIMIT ? text.slice(0, STATUS_BUBBLE_TEXT_LIMIT).replace(/[\uD800-\uDBFF]$/u, '') : text
}

/**
 * How Chrome's status bubble writes a link's address (url_formatter::FormatUrl with kFormatUrlOmitDefaults and
 * UnescapeRule::SPACES): without a user name or password, without `http://` unless the host starts with `ftp.`, which
 * would read as another scheme, without the slash after a bare host, and with escaped spaces as spaces. The host stays
 * as the address bar shows it. Nothing for an empty address, which takes the bubble away.
 */
export function statusBubbleText(url: string): StatusBubbleText | undefined {
  if (!url) return undefined
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { scheme: '', host: '', rest: capped(url) }
  }
  // An address with no host, such as mailto:, javascript:, data: or blob:, is written as it is.
  if (!parsed.host && parsed.protocol !== 'file:') return { scheme: '', host: '', rest: capped(parsed.href) }
  parsed.username = ''
  parsed.password = ''
  const scheme = parsed.protocol === 'http:' && !parsed.hostname.startsWith('ftp.') ? '' : `${parsed.protocol}//`
  const rest = parsed.href.slice(parsed.protocol.length + 2 + parsed.host.length)
  return {
    scheme,
    host: capped(parsed.host),
    rest: rest === '/' && parsed.host ? '' : capped(rest.replaceAll('%20', ' '))
  }
}

function finite(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
}

export function parseStatusBubbleMeasurement(value: unknown): StatusBubbleMeasurement | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const measurement = value as Record<string, unknown>
  if (
    !Number.isSafeInteger(measurement.id) || (measurement.id as number) < 1
    || !finite(measurement.width, 1, 100_000) || !finite(measurement.height, 1, 100_000)
    || typeof measurement.shortened !== 'boolean'
  ) return undefined
  return { id: measurement.id as number, width: measurement.width, height: measurement.height, shortened: measurement.shortened }
}

import { pluralFormIndex } from '../../../shared/plural.js'
export function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id)
  if (!node) throw new Error(`Missing Home element: ${id}`)
  return node as T
}
export function escapeText(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
export function renderStatus(target: HTMLElement, status: string, label: string): void {
  const dot = document.createElement('span')
  dot.className = `dot ${status}`
  target.replaceChildren(dot, document.createTextNode(` ${label}`))
  // The status can be cut to fit; the whole of it is there on hover.
  target.title = label
}
/** Fills `{name}` placeholders in one pass, so a value is shown as written: `$&` or another placeholder in a page's
 * text is never read as a pattern. */
export function interpolate(message: string, values: Record<string, string | number> = {}): string {
  return message.replace(/\{(\w+)\}/gu, (placeholder, key: string) => Object.hasOwn(values, key) ? String(values[key]) : placeholder)
}
/** A failure's words for the person, without the wrapper Electron puts around a main-process error, or the fallback. */
export function errorText(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : ''
  const message = raw
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()
  return message || fallback
}
export function remember(key: string, value?: string): string | null {
  try {
    if (value !== undefined) window.localStorage.setItem(key, value)
    return window.localStorage.getItem(key)
  } catch { return null }
}
/** The message at a dotted key, such as `shell.agents.steps.click`, with its placeholders filled in; the key itself
 * when there is none. */
export function messageAt(messages: unknown, key: string, values: Record<string, string | number> = {}): string {
  const found = key.split('.').reduce<unknown>((node, part) => node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined, messages)
  return typeof found === 'string' ? interpolate(found, values) : key
}
/** The plural form of a `one | other` message for the count, with `{count}` formatted for the locale. */
export function pluralText(locale: string, message: string, value: number): string {
  const forms = message.split(' | ')
  return interpolate(forms[pluralFormIndex(locale, value, forms.length)] ?? forms[0]!, { count: new Intl.NumberFormat(locale).format(value) })
}
/** How long ago, in the locale's words: "5 minutes ago", "yesterday". */
export function timeAgo(locale: string, value: string | number, now = Date.now()): string {
  const at = typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isFinite(at)) return ''
  const seconds = Math.round((at - now) / 1000)
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const size = Math.abs(seconds)
  if (size < 45) return format.format(0, 'second')
  if (size < 3600) return format.format(Math.round(seconds / 60), 'minute')
  if (size < 86400) return format.format(Math.round(seconds / 3600), 'hour')
  if (size < 86400 * 30) return format.format(Math.round(seconds / 86400), 'day')
  return format.format(Math.round(seconds / (86400 * 30)), 'month')
}

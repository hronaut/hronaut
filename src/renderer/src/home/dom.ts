export function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id)
  if (!node) throw new Error(`Missing Home element: ${id}`)
  return node as T
}
export function escapeText(value: unknown): string {
  const node = document.createElement('span')
  node.textContent = String(value ?? '')
  return node.innerHTML.replaceAll('"', '&quot;')
}
export function interpolate(message: string, values: Record<string, string | number> = {}): string {
  return Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), message)
}
export function remember(key: string, value?: string): string | null {
  try {
    if (value !== undefined) window.localStorage.setItem(key, value)
    return window.localStorage.getItem(key)
  } catch { return null }
}

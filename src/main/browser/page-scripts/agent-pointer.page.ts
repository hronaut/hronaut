/** Who an agent's cursor belongs to: its client's name (may be empty), and the avatar's fill and ink colors. */
export interface AgentPointerIdentity {
  name: string
  fill: string
  ink: string
}

/** What the cursor shows at the point: a move, a click, or the start or end of a drag. */
export type AgentPointerEffect = 'move' | 'click' | 'drag-start' | 'drag-end'

/** The one cursor of a document, kept in the agent pointer's isolated world. */
interface AgentCursorState {
  host: HTMLElement
  root: ShadowRoot
  cursor: HTMLElement
  pointer: HTMLElement
  tag: HTMLElement
  x: number
  y: number
  arriveAt: number
  pressed: boolean
  timers: Array<ReturnType<typeof setTimeout>>
}

type AgentPointerWorld = typeof globalThis & { __hronautAgentCursor?: AgentCursorState }

/**
 * Runs in the agent pointer's isolated world: takes the cursor off the page and resolves once the page has painted
 * without it, or at once when there is none. Only Hronaut's own hosts, which sit directly under the root element, are
 * removed.
 */
export async function dismissAgentPointerInPage(): Promise<boolean> {
  const world = globalThis as AgentPointerWorld
  const state = world.__hronautAgentCursor
  if (state && Array.isArray(state.timers)) for (const timer of state.timers) clearTimeout(timer)
  world.__hronautAgentCursor = undefined
  const hosts = document.documentElement.querySelectorAll(':scope > [data-hronaut-agent-pointer]')
  if (!hosts.length) return false
  hosts.forEach((node) => node.remove())
  await new Promise((resolve) => {
    setTimeout(resolve, 100)
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  })
  return true
}

/**
 * Runs in the agent pointer's isolated world: draws the agent's cursor gliding to the point, with a ripple for a click
 * or the start of a drag, and fades it out idleMs after it arrives, over fadeMs. False for a point or origin that is not
 * finite. A name is shown only with valid colors and up to 128 characters.
 */
export function agentPointerInPage(
  point: { x: number; y: number },
  effect: AgentPointerEffect,
  origin: { x: number; y: number } | null,
  agent: AgentPointerIdentity | null,
  idleMs: number,
  fadeMs: number
): boolean {
  const world = globalThis as AgentPointerWorld
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false
  if (origin && (!Number.isFinite(origin.x) || !Number.isFinite(origin.y))) return false
  const color = (value: unknown): boolean => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
  const colored = !!agent && color(agent.fill) && color(agent.ink)
  const name = colored && typeof agent!.name === 'string' && agent!.name.length <= 128 ? agent!.name : ''
  const media = (query: string): boolean => typeof matchMedia === 'function' && matchMedia(query).matches
  const reduced = media('(prefers-reduced-motion: reduce)')
  const forced = media('(forced-colors: active)')
  const now = (): number => (typeof performance === 'object' ? performance.now() : Date.now())
  // The host shares the page's DOM, so its own styles outrank the page's, even !important ones.
  const pin = (element: HTMLElement, styles: Record<string, string>): void => {
    for (const [property, value] of Object.entries(styles)) element.style.setProperty(property, value, 'important')
  }

  // One cursor per document, kept in this isolated world, so the next step glides from where it is.
  let state = world.__hronautAgentCursor
  if (!state || !(state.host instanceof HTMLElement) || !state.host.isConnected
    || state.host.getAttribute('data-hronaut-agent-pointer') !== 'v2' || !(state.cursor instanceof HTMLElement)) state = undefined
  let fresh = false
  if (!state) {
    document.documentElement.querySelectorAll(':scope > [data-hronaut-agent-pointer]').forEach((node) => node.remove())
    const host = document.createElement('div')
    host.setAttribute('data-hronaut-agent-pointer', 'v2')
    host.setAttribute('aria-hidden', 'true')
    pin(host, {
      all: 'initial',
      display: 'block',
      position: 'fixed',
      left: '0',
      top: '0',
      width: '0',
      height: '0',
      transform: 'none',
      'z-index': '2147483647',
      'pointer-events': 'none',
      opacity: '1',
      transition: 'opacity ' + fadeMs + 'ms ease',
      contain: 'style',
      'forced-color-adjust': 'none'
    })
    const root = host.attachShadow({ mode: 'closed' })
    // The cursor moves inside the host, so ripples can stay where the input happened.
    const cursor = document.createElement('div')
    cursor.setAttribute('data-cursor', '')
    Object.assign(cursor.style, { position: 'absolute', left: '0', top: '0' })
    const pointer = document.createElement('div')
    pointer.setAttribute('data-arrow', '')
    Object.assign(pointer.style, {
      position: 'absolute',
      left: '-2px',
      top: '-2px',
      width: '18px',
      height: '24px',
      clipPath: 'polygon(0 0, 100% 68%, 57% 72%, 38% 100%)',
      filter: 'drop-shadow(0 0 1px white) drop-shadow(0 2px 3px rgba(0,0,0,.45))',
      transformOrigin: '2px 2px',
      transition: reduced ? 'none' : 'transform 120ms ease-out'
    })
    const tag = document.createElement('span')
    tag.setAttribute('dir', 'auto')
    Object.assign(tag.style, {
      position: 'absolute',
      left: '14px',
      top: '20px',
      maxWidth: '180px',
      padding: '0 8px',
      borderRadius: '999px',
      font: '500 12px/18px system-ui, sans-serif',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      boxShadow: '0 1px 3px rgba(0,0,0,.3)',
      boxSizing: 'border-box'
    })
    cursor.append(pointer, tag)
    root.append(cursor)
    const start = effect === 'drag-end' && origin ? origin : point
    cursor.style.transform = 'translate3d(' + start.x + 'px,' + start.y + 'px,0)'
    document.documentElement.append(host)
    state = { host, root, cursor, pointer, tag, x: start.x, y: start.y, arriveAt: 0, pressed: false, timers: [] }
    world.__hronautAgentCursor = state
    fresh = true
  }
  const cursorState = state
  const { host, root, cursor, pointer, tag } = cursorState
  for (const timer of cursorState.timers) clearTimeout(timer)
  cursorState.timers = []
  const later = (callback: () => void, delay: number): void => { cursorState.timers.push(setTimeout(callback, delay)) }

  pointer.style.background = forced ? 'CanvasText' : colored ? agent!.fill : '#6757e8'
  tag.textContent = name
  tag.style.display = name ? 'block' : 'none'
  Object.assign(tag.style, forced
    ? { background: 'Canvas', color: 'CanvasText', border: '1px solid CanvasText' }
    : { background: colored ? agent!.fill : '#6757e8', color: colored ? agent!.ink : '#ffffff', border: '0' })
  pin(host, { opacity: '1' })

  // A ripple marks where the input happened, when it happened, wherever the cursor is in its glide.
  const ripple = (): void => {
    const ripples = root.querySelectorAll('[data-ripple]')
    if (ripples.length >= 3) ripples[0]!.remove()
    const pulse = document.createElement('div')
    pulse.setAttribute('data-ripple', '')
    Object.assign(pulse.style, {
      position: 'absolute',
      left: (point.x - 12) + 'px',
      top: (point.y - 12) + 'px',
      width: '24px',
      height: '24px',
      border: '2px solid ' + (forced ? 'Highlight' : colored ? agent!.fill : '#8d80ff'),
      borderRadius: '999px',
      boxSizing: 'border-box',
      opacity: '0'
    })
    root.append(pulse)
    const frames = reduced
      ? [{ opacity: 0.9 }, { opacity: 0 }]
      : [{ opacity: 0.9, transform: 'scale(.35)' }, { opacity: 0, transform: 'scale(1.6)' }]
    if (typeof pulse.animate === 'function') {
      const animation = pulse.animate(frames, { duration: 600, easing: 'ease-out' })
      animation.finished.then(() => pulse.remove(), () => pulse.remove())
    } else {
      setTimeout(() => pulse.remove(), 600)
    }
  }
  if (effect === 'click' || effect === 'drag-start') ripple()

  const glide = (): void => {
    // Measure from where the cursor is on screen, which is not its last target while it is still gliding.
    let fromX = cursorState.x
    let fromY = cursorState.y
    if (now() < cursorState.arriveAt && typeof DOMMatrixReadOnly === 'function') {
      try {
        const matrix = new DOMMatrixReadOnly(getComputedStyle(cursor).transform)
        fromX = matrix.m41
        fromY = matrix.m42
      } catch { /* An unparsable transform keeps the last target. */ }
    }
    const distance = Math.hypot(point.x - fromX, point.y - fromY)
    const duration = reduced || distance < 1 ? 0 : Math.round(Math.min(900, Math.max(600, 600 + distance * 0.25)))
    if (fresh && duration) cursor.getBoundingClientRect()
    cursor.style.transition = duration ? 'transform ' + duration + 'ms cubic-bezier(.16,1,.3,1)' : 'none'
    cursor.style.transform = 'translate3d(' + point.x + 'px,' + point.y + 'px,0)'
    cursorState.x = point.x
    cursorState.y = point.y
    cursorState.arriveAt = now() + duration
    const pressed = effect === 'drag-start' || effect === 'drag-end'
    cursorState.pressed = effect === 'drag-start'
    pointer.style.transform = pressed ? 'scale(.84)' : 'scale(1)'
    // A drag lets go once it reaches its end.
    if (effect === 'drag-end') later(() => { pointer.style.transform = 'scale(1)' }, duration)
    later(() => { pin(host, { opacity: '0' }) }, duration + idleMs)
    later(() => {
      host.remove()
      if (world.__hronautAgentCursor === cursorState) world.__hronautAgentCursor = undefined
    }, duration + idleMs + fadeMs)
  }
  // The end of a drag starts from the drag's start, so it waits for the cursor to get there.
  const wait = effect === 'drag-end' && cursorState.pressed ? Math.max(0, Math.ceil(cursorState.arriveAt - now())) : 0
  if (wait) {
    pointer.style.transform = 'scale(.84)'
    later(glide, wait)
  } else {
    glide()
  }
  return true
}

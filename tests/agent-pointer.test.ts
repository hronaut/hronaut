// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_POINTER_FADE_MS,
  AGENT_POINTER_IDLE_MS,
  agentPointerScript,
  dismissAgentPointerScript,
  type AgentPointerIdentity
} from '../src/main/browser/page-scripts.js'

const CLAUDE: AgentPointerIdentity = { name: 'Claude Code', fill: '#2aa198', ink: '#111318' }

let roots: ShadowRoot[] = []

function run(
  point: { x: number; y: number },
  effect: 'move' | 'click' | 'drag-start' | 'drag-end',
  origin?: { x: number; y: number },
  agent?: AgentPointerIdentity
): unknown {
  return window.eval(agentPointerScript(point, effect, origin, agent))
}

function host(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-hronaut-agent-pointer]')
}

/** The cursor's closed shadow root, as the page can never reach it. */
function root(): ShadowRoot {
  return roots.at(-1)!
}

function tag(): HTMLElement {
  return root().querySelector<HTMLElement>('span')!
}

function arrow(): HTMLElement {
  return root().querySelector<HTMLElement>('[data-arrow]')!
}

/** The part that glides; the host stays put, so ripples stay where the input happened. */
function cursor(): HTMLElement {
  return root().querySelector<HTMLElement>('[data-cursor]')!
}

function ripples(): HTMLElement[] {
  return [...root().querySelectorAll<HTMLElement>('[data-ripple]')]
}

function reducedMotion(reduced: boolean): void {
  window.matchMedia = vi.fn((query: string) => ({ matches: reduced && query.includes('reduce') })) as unknown as typeof window.matchMedia
}

describe('agent cursor on the page', () => {
  beforeEach(() => {
    roots = []
    const attachShadow = Element.prototype.attachShadow
    vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init: ShadowRootInit) {
      const shadow = attachShadow.call(this, init)
      roots.push(shadow)
      return shadow
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    delete (window as { matchMedia?: unknown }).matchMedia
    delete (globalThis as { __hronautAgentCursor?: unknown }).__hronautAgentCursor
    document.documentElement.innerHTML = '<head></head><body></body>'
  })

  it('shows one pointer-transparent cursor that the page cannot read or announce, and moves it across agent actions', () => {
    expect(run({ x: 25, y: 40 }, 'move', undefined, CLAUDE)).toBe(true)
    const first = host()
    expect(first?.getAttribute('data-hronaut-agent-pointer')).toBe('v2')
    expect(first?.getAttribute('aria-hidden')).toBe('true')
    expect(first?.style.pointerEvents).toBe('none')
    expect(first?.style.opacity).toBe('1')
    expect(cursor().style.transform).toContain('25px')
    expect(first?.shadowRoot).toBeNull()
    // The page's own !important rules cannot restyle the host.
    for (const property of ['position', 'pointer-events', 'z-index', 'opacity', 'transform']) {
      expect(first?.style.getPropertyPriority(property), property).toBe('important')
    }

    expect(run({ x: 90, y: 120 }, 'click', undefined, CLAUDE)).toBe(true)
    expect(document.querySelectorAll('[data-hronaut-agent-pointer]')).toHaveLength(1)
    expect(host()).toBe(first)
    expect(cursor().style.transform).toContain('90px')
  })

  it('glides from where it was in 600 to 900 ms, by distance, and the call returns at once', () => {
    run({ x: 0, y: 0 }, 'move', undefined, CLAUDE)
    // The first cursor on a page starts at its target.
    expect(cursor().style.transition).not.toContain('transform')
    run({ x: 400, y: 0 }, 'move', undefined, CLAUDE)
    expect(cursor().style.transition).toContain('transform 700ms')
    run({ x: 410, y: 0 }, 'move', undefined, CLAUDE)
    expect(cursor().style.transition).toContain('transform 603ms')
    run({ x: 3_000, y: 0 }, 'move', undefined, CLAUDE)
    expect(cursor().style.transition).toContain('transform 900ms')
    // Staying put is no glide.
    run({ x: 3_000, y: 0 }, 'click', undefined, CLAUDE)
    expect(cursor().style.transition).not.toContain('transform')
  })

  it('measures a new glide from where the cursor is on screen, not from the target it had not reached', () => {
    const at = { x: 0 }
    const DOMMatrix = vi.fn(function (this: { m41: number; m42: number }) { this.m41 = at.x; this.m42 = 0 })
    vi.stubGlobal('DOMMatrixReadOnly', DOMMatrix)
    try {
      run({ x: 0, y: 0 }, 'move', undefined, CLAUDE)
      run({ x: 1_000, y: 0 }, 'move', undefined, CLAUDE)
      // Turned back after 20 px of a 1,000 px glide: 20 px to go, not 1,000.
      at.x = 20
      run({ x: 0, y: 0 }, 'move', undefined, CLAUDE)
      expect(DOMMatrix).toHaveBeenCalled()
      expect(cursor().style.transition).toContain('transform 605ms')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('carries the agent\'s name in its avatar colors, as text only', () => {
    run({ x: 10, y: 10 }, 'move', undefined, CLAUDE)
    expect(tag().textContent).toBe('Claude Code')
    expect(tag().getAttribute('dir')).toBe('auto')
    expect(tag().style.display).toBe('block')
    expect(tag().style.background).toContain('rgb(42, 161, 152)')
    expect(tag().style.color).toBe('rgb(17, 19, 24)')
    expect(arrow().style.background).toContain('rgb(42, 161, 152)')

    const innerHTML = vi.spyOn(Element.prototype, 'innerHTML', 'set')
    run({ x: 20, y: 20 }, 'move', undefined, { ...CLAUDE, name: '<img src=x onerror="window.hacked = 1">' })
    expect(tag().textContent).toBe('<img src=x onerror="window.hacked = 1">')
    expect(root().querySelector('img')).toBeNull()
    expect(innerHTML).not.toHaveBeenCalled()
  })

  it('draws an unnamed cursor without an agent, or with a color or name it cannot trust', () => {
    run({ x: 10, y: 10 }, 'move')
    expect(tag().style.display).toBe('none')
    expect(arrow().style.background).toContain('rgb(103, 87, 232)')
    run({ x: 10, y: 10 }, 'move', undefined, { ...CLAUDE, fill: 'red; background-image: url(x)' })
    expect(tag().style.display).toBe('none')
    expect(arrow().style.background).toContain('rgb(103, 87, 232)')
    run({ x: 10, y: 10 }, 'move', undefined, { ...CLAUDE, name: 'x'.repeat(129) })
    expect(tag().style.display).toBe('none')
  })

  it('leaves a ripple where it clicks as the click happens, while the cursor is still on its way, and none for a move', () => {
    vi.useFakeTimers()
    run({ x: 0, y: 0 }, 'move', undefined, CLAUDE)
    run({ x: 400, y: 30 }, 'click', undefined, CLAUDE)
    // The page already has the click, so the ripple does not wait for the glide.
    expect(ripples()).toHaveLength(1)
    expect(ripples()[0]?.style.left).toBe('388px')
    expect(ripples()[0]?.style.top).toBe('18px')
    // It is drawn beside the cursor, not inside the part that glides.
    expect(cursor().contains(ripples()[0]!)).toBe(false)
    vi.advanceTimersByTime(600)
    expect(ripples()).toHaveLength(0)
    run({ x: 800, y: 0 }, 'move', undefined, CLAUDE)
    vi.advanceTimersByTime(2_000)
    expect(ripples()).toHaveLength(0)
  })

  it('stays two seconds after it arrives, then fades and leaves without touching the page', () => {
    vi.useFakeTimers()
    const pageButton = document.createElement('button')
    document.body.append(pageButton)
    run({ x: 0, y: 0 }, 'move', undefined, CLAUDE)
    run({ x: 400, y: 0 }, 'click', undefined, CLAUDE)
    const cursor = host()
    vi.advanceTimersByTime(700 + AGENT_POINTER_IDLE_MS - 1)
    expect(cursor?.style.opacity).toBe('1')
    vi.advanceTimersByTime(1)
    expect(cursor?.style.opacity).toBe('0')
    // A step during the fade brings it back.
    run({ x: 400, y: 0 }, 'move', undefined, CLAUDE)
    expect(cursor?.style.opacity).toBe('1')
    vi.advanceTimersByTime(AGENT_POINTER_IDLE_MS + AGENT_POINTER_FADE_MS - 1)
    expect(cursor?.isConnected).toBe(true)
    vi.advanceTimersByTime(1)
    expect(cursor?.isConnected).toBe(false)
    expect(pageButton.isConnected).toBe(true)
    expect((globalThis as { __hronautAgentCursor?: unknown }).__hronautAgentCursor).toBeUndefined()
  })

  it('jumps without gliding or a growing ripple when the system asks for reduced motion', () => {
    reducedMotion(true)
    const animate = vi.fn(() => ({ finished: Promise.resolve() }))
    ;(HTMLElement.prototype as { animate?: unknown }).animate = animate
    try {
      run({ x: 0, y: 0 }, 'move', undefined, CLAUDE)
      run({ x: 400, y: 0 }, 'click', undefined, CLAUDE)
      expect(cursor().style.transition).not.toContain('transform')
      expect(cursor().style.transform).toContain('400px')
      expect(animate).toHaveBeenCalledOnce()
      expect(JSON.stringify(animate.mock.calls[0])).not.toContain('scale')
    } finally {
      delete (HTMLElement.prototype as { animate?: unknown }).animate
    }
  })

  it('rejects non-finite coordinates without adding a cursor', () => {
    expect(run({ x: Number.NaN, y: 10 }, 'move', undefined, CLAUDE)).toBe(false)
    expect(host()).toBeNull()
  })

  it('glides a drag\'s end from its origin, pressed, when it has no cursor yet', () => {
    vi.useFakeTimers()
    expect(run({ x: 90, y: 75 }, 'drag-end', { x: 10, y: 15 }, CLAUDE)).toBe(true)
    expect(document.querySelectorAll('[data-hronaut-agent-pointer]')).toHaveLength(1)
    // 100 px from its origin.
    expect(cursor().style.transition).toContain('transform 625ms')
    expect(cursor().style.transform).toContain('90px')
    expect(arrow().style.transform).toBe('scale(.84)')
    vi.advanceTimersByTime(625)
    expect(arrow().style.transform).toBe('scale(1)')
  })

  it('shows a whole drag: a ripple where it grabs, then the end waits for the cursor to get there and lets go on arrival', () => {
    vi.useFakeTimers()
    run({ x: 0, y: 0 }, 'move', undefined, CLAUDE)
    vi.advanceTimersByTime(3_000)
    run({ x: 0, y: 0 }, 'move', undefined, CLAUDE)
    // The native drag reaches the page in a few milliseconds, long before the cursor reaches its start.
    run({ x: 400, y: 0 }, 'drag-start', undefined, CLAUDE)
    expect(ripples()).toHaveLength(1)
    expect(ripples()[0]?.style.left).toBe('388px')
    expect(arrow().style.transform).toBe('scale(.84)')
    vi.advanceTimersByTime(20)
    run({ x: 400, y: 200 }, 'drag-end', { x: 400, y: 0 }, CLAUDE)
    expect(cursor().style.transform).toContain('400px,0px')
    expect(arrow().style.transform).toBe('scale(.84)')
    vi.advanceTimersByTime(679)
    expect(cursor().style.transform).toContain('400px,0px')
    vi.advanceTimersByTime(1)
    // At the drag's start, it moves on to its end, still pressed: 200 px is 650 ms.
    expect(cursor().style.transform).toContain('400px,200px')
    expect(cursor().style.transition).toContain('transform 650ms')
    expect(arrow().style.transform).toBe('scale(.84)')
    vi.advanceTimersByTime(649)
    expect(arrow().style.transform).toBe('scale(.84)')
    vi.advanceTimersByTime(1)
    expect(arrow().style.transform).toBe('scale(1)')
    // It still stays two seconds after it arrives.
    vi.advanceTimersByTime(AGENT_POINTER_IDLE_MS - 1)
    expect(host()?.style.opacity).toBe('1')
    vi.advanceTimersByTime(1)
    expect(host()?.style.opacity).toBe('0')
  })

  it('does not trust cursor state or hosts left behind, and leaves the page\'s own elements alone', () => {
    const stale = document.createElement('div')
    stale.setAttribute('data-hronaut-agent-pointer', 'v1')
    document.documentElement.append(stale)
    // A page element that happens to carry the attribute is not Hronaut's.
    const pageElement = document.createElement('section')
    pageElement.setAttribute('data-hronaut-agent-pointer', 'v2')
    document.body.append(pageElement)
    ;(globalThis as { __hronautAgentCursor?: unknown }).__hronautAgentCursor = { host: document.body, root: document, cursor: document.body, pointer: document.body, tag: document.body, x: 0, y: 0, timers: [] }

    expect(run({ x: 44, y: 55 }, 'move', undefined, CLAUDE)).toBe(true)
    expect(document.body.style.transform).toBe('')
    expect(document.body.style.opacity).toBe('')
    expect(stale.isConnected).toBe(false)
    expect(pageElement.isConnected).toBe(true)
    const own = document.documentElement.querySelector<HTMLElement>(':scope > [data-hronaut-agent-pointer]')
    expect(own?.getAttribute('data-hronaut-agent-pointer')).toBe('v2')
  })

  it('takes the cursor off the page before an agent capture, and says when there was none', async () => {
    const pageElement = document.createElement('section')
    pageElement.setAttribute('data-hronaut-agent-pointer', 'v2')
    document.body.append(pageElement)
    run({ x: 10, y: 10 }, 'click', undefined, CLAUDE)
    window.requestAnimationFrame = (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0) as unknown as number
    await expect(window.eval(dismissAgentPointerScript())).resolves.toBe(true)
    expect(document.documentElement.querySelector(':scope > [data-hronaut-agent-pointer]')).toBeNull()
    expect(pageElement.isConnected).toBe(true)
    expect((globalThis as { __hronautAgentCursor?: unknown }).__hronautAgentCursor).toBeUndefined()
    await expect(window.eval(dismissAgentPointerScript())).resolves.toBe(false)
  })
})

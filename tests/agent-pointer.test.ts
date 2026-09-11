// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentPointerScript } from '../src/main/browser/page-scripts.js'

function run(
  point: { x: number; y: number },
  effect: 'move' | 'click' | 'drag-start' | 'drag-end',
  origin?: { x: number; y: number }
): unknown {
  return window.eval(agentPointerScript(point, effect, origin))
}

describe('agent pointer overlay', () => {
  afterEach(() => {
    vi.useRealTimers()
    document.documentElement.innerHTML = '<head></head><body></body>'
  })

  it('shows one pointer-transparent overlay and replaces it across agent actions', () => {
    expect(run({ x: 25, y: 40 }, 'move')).toBe(true)
    const host = document.querySelector<HTMLElement>('[data-hronaut-agent-pointer]')

    expect(host).not.toBeNull()
    expect(host?.style.pointerEvents).toBe('none')
    expect(host?.style.opacity).toBe('1')
    expect(host?.style.transform).toContain('25px')
    expect(host?.shadowRoot).toBeNull()

    expect(run({ x: 90, y: 120 }, 'click')).toBe(true)
    expect(document.querySelectorAll('[data-hronaut-agent-pointer]')).toHaveLength(1)
    expect(document.querySelector<HTMLElement>('[data-hronaut-agent-pointer]')?.style.transform).toContain('90px')
  })

  it('hides after the bounded visibility interval without removing page content', () => {
    vi.useFakeTimers()
    const pageButton = document.createElement('button')
    document.body.append(pageButton)

    expect(run({ x: 12, y: 18 }, 'move')).toBe(true)
    const host = document.querySelector<HTMLElement>('[data-hronaut-agent-pointer]')
    vi.advanceTimersByTime(1_200)

    expect(host?.isConnected).toBe(false)
    expect(pageButton.isConnected).toBe(true)
  })

  it('rejects non-finite coordinates without adding an overlay', () => {
    expect(run({ x: Number.NaN, y: 10 }, 'move')).toBe(false)
    expect(document.querySelector('[data-hronaut-agent-pointer]')).toBeNull()
  })

  it('renders drag completion with an origin without adding extra pointer hosts', () => {
    expect(run({ x: 90, y: 75 }, 'drag-end', { x: 10, y: 15 })).toBe(true)
    expect(document.querySelectorAll('[data-hronaut-agent-pointer="v1"]')).toHaveLength(1)
  })

  it('does not trust page-defined pointer state', () => {
    const pageState = { host: document.body, pointer: document.body, hideTimer: 0 }
    ;(window as Window & { __hronautAgentPointer?: unknown }).__hronautAgentPointer = pageState

    expect(run({ x: 44, y: 55 }, 'move')).toBe(true)
    expect(document.body.style.transform).toBe('')
    expect(document.body.style.opacity).toBe('')

    delete (window as Window & { __hronautAgentPointer?: unknown }).__hronautAgentPointer
  })
})

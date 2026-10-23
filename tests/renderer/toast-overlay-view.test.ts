import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ToastOverlayMeasurement, ToastOverlayMessage, ToastOverlayState } from '../../src/shared/toast-overlay.js'

function state(overrides: Partial<ToastOverlayState> = {}): ToastOverlayState {
  return {
    revision: 1,
    toast: { id: 1, tone: 'success', title: 'Tab closed', message: '<img src=x onerror=alert(1)>', action: { label: 'Undo' } },
    focus: null,
    theme: 'dark',
    width: 560,
    ...overrides
  }
}

async function loadView() {
  vi.resetModules()
  document.body.innerHTML = '<div id="toast-overlay-root" aria-hidden="true"></div>'
  let render!: (value: ToastOverlayState) => void
  const sent: ToastOverlayMessage[] = []
  const measured: ToastOverlayMeasurement[] = []
  window.hronautToastOverlayView = {
    onState: (listener) => { render = listener; return () => undefined },
    measured: (measurement) => { measured.push(measurement) },
    send: (message) => { sent.push(message) }
  }
  await import('../../src/renderer/src/toast-overlay.js')
  const toast = () => document.querySelector<HTMLElement>('.toast-overlay')!
  return { render: (value: ToastOverlayState) => render(value), sent, measured, toast }
}

afterEach(() => {
  document.body.innerHTML = ''
  delete document.documentElement.dataset.theme
})

describe('toast overlay view', () => {
  it('draws the toast as text at the width main gives, in the shell theme, and moves in only when new', async () => {
    const view = await loadView()
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 40.4 } as DOMRect)
    view.render(state())
    const toast = view.toast()
    expect(toast).toHaveClass('toast-overlay', 'success', 'with-action')
    expect(document.querySelector('img')).toBeNull()
    expect(toast.querySelector('strong')?.textContent).toBe('Tab closed')
    expect(toast.querySelector('.toast-overlay-copy span')?.textContent).toBe('<img src=x onerror=alert(1)>')
    expect(toast.querySelector('.toast-overlay-action')?.textContent).toBe('Undo')
    expect(toast.querySelector('svg path')?.getAttribute('fill')).toBe('currentColor')
    expect(toast.dataset.opening).toBe('true')
    expect(document.documentElement.dataset.theme).toBe('dark')
    // The toast's own width: the view has no room around it, where the page got no clicks.
    expect(document.querySelector<HTMLElement>('#toast-overlay-root')?.style.width).toBe('560px')
    expect(view.measured).toEqual([{ revision: 1, height: 41 }])
    // Only the shell's copy is in the accessibility tree and keyboard order.
    expect(document.querySelector('#toast-overlay-root')?.getAttribute('aria-hidden')).toBe('true')
    expect([...toast.querySelectorAll('button')].map((button) => button.tabIndex)).toEqual([-1, -1])

    view.render(state({ revision: 2, focus: 'action', theme: 'light' }))
    expect(view.toast().dataset.opening).toBeUndefined()
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(view.measured).toEqual([{ revision: 1, height: 41 }, { revision: 2, height: 41 }])
  })

  it('rings the button that has keyboard focus in the shell copy', async () => {
    const view = await loadView()
    view.render(state({ focus: 'action' }))
    expect(view.toast().querySelector<HTMLElement>('.toast-overlay-action')?.dataset.focused).toBe('true')
    expect(view.toast().querySelector<HTMLElement>('.toast-overlay-dismiss')?.dataset.focused).toBeUndefined()
    view.render(state({ revision: 2, focus: 'dismiss' }))
    expect(view.toast().querySelector<HTMLElement>('.toast-overlay-action')?.dataset.focused).toBeUndefined()
    expect(view.toast().querySelector<HTMLElement>('.toast-overlay-dismiss')?.dataset.focused).toBe('true')
  })

  it('reports clicks and hover for the toast it shows, without taking focus on a press', async () => {
    const view = await loadView()
    view.render(state({ toast: { ...state().toast, id: 7 } }))
    const toast = view.toast()
    const action = toast.querySelector<HTMLButtonElement>('.toast-overlay-action')!
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    action.dispatchEvent(press)
    expect(press.defaultPrevented).toBe(true)
    toast.dispatchEvent(new Event('pointerenter'))
    action.click()
    toast.dispatchEvent(new Event('pointerleave'))
    toast.querySelector<HTMLButtonElement>('.toast-overlay-dismiss')!.click()
    expect(view.sent).toEqual([
      { id: 7, kind: 'retain' },
      { id: 7, kind: 'act' },
      { id: 7, kind: 'release' },
      { id: 7, kind: 'dismiss' }
    ])
  })

  it('draws a toast without an action with only its dismiss button, and does not hold it on hover', async () => {
    const view = await loadView()
    view.render(state({ toast: { id: 3, tone: 'error', title: 'Reload failed', message: 'Renderer unavailable' } }))
    const toast = view.toast()
    expect(toast).toHaveClass('error')
    expect(toast).not.toHaveClass('with-action')
    expect(toast.querySelectorAll('button')).toHaveLength(1)
    toast.dispatchEvent(new Event('pointerenter'))
    expect(view.sent).toEqual([])
  })
})

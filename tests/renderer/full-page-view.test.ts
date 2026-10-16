import { effectScope, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useFullPageView } from '../../src/renderer/src/composables/useFullPageView.js'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); document.body.replaceChildren() })

function harness(options: { available?: boolean } = {}) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const scope = effectScope()
  const available = ref(options.available ?? true)
  const attention = ref(false)
  const view = scope.run(() => useFullPageView({ available, attention }))!
  const chrome = document.createElement('div')
  const field = document.createElement('input')
  const outside = document.createElement('input')
  chrome.append(field)
  document.body.append(chrome, outside)
  chrome.addEventListener('mouseenter', view.reveal)
  chrome.addEventListener('mouseleave', view.conceal)
  chrome.addEventListener('focusin', view.reveal)
  chrome.addEventListener('focusout', view.focusOut)
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  return { view, available, attention, chrome, field, outside, dispose: () => scope.stop() }
}

describe('full-page view', () => {
  it('turns on only over a website, and off anywhere', () => {
    const h = harness({ available: false })
    try {
      expect(h.view.toggle()).toBe(false)
      expect(h.view.enabled.value).toBe(false)
      h.available.value = true
      expect(h.view.toggle()).toBe(true)
      expect(h.view.concealed.value).toBe(true)
      // Home or Settings shows the usual chrome; the view comes back on the next website.
      h.available.value = false
      expect(h.view.active.value).toBe(false)
      expect(h.view.concealed.value).toBe(false)
      h.available.value = true
      expect(h.view.concealed.value).toBe(true)
      h.available.value = false
      expect(h.view.toggle()).toBe(true)
      expect(h.view.enabled.value).toBe(false)
    } finally { h.dispose() }
  })

  it('shows the chrome after a short rest at the edge and hides it once the pointer leaves', () => {
    const h = harness()
    try {
      h.view.toggle()
      h.chrome.dispatchEvent(new MouseEvent('mouseenter'))
      vi.advanceTimersByTime(80)
      // A pointer passing on its way elsewhere does not move the page.
      h.chrome.dispatchEvent(new MouseEvent('mouseleave'))
      vi.advanceTimersByTime(500)
      expect(h.view.concealed.value).toBe(true)
      h.chrome.dispatchEvent(new MouseEvent('mouseenter'))
      vi.advanceTimersByTime(180)
      expect(h.view.concealed.value).toBe(false)
      h.chrome.dispatchEvent(new MouseEvent('mouseleave'))
      vi.advanceTimersByTime(259)
      expect(h.view.concealed.value).toBe(false)
      vi.advanceTimersByTime(1)
      expect(h.view.concealed.value).toBe(true)
    } finally { h.dispose() }
  })

  it('keeps the chrome while it has focus and hides it when the window loses focus to the page', () => {
    const h = harness()
    try {
      h.view.toggle()
      h.field.focus()
      expect(h.view.concealed.value).toBe(false)
      h.chrome.dispatchEvent(new MouseEvent('mouseleave'))
      vi.advanceTimersByTime(500)
      expect(h.view.concealed.value).toBe(false)
      // Clicking the page takes focus from the shell's window.
      window.dispatchEvent(new Event('blur'))
      expect(h.view.concealed.value).toBe(true)
    } finally { h.dispose() }
  })

  it('stays in view when it starts while you work in the chrome', () => {
    const h = harness()
    try {
      h.field.focus()
      h.view.toggle()
      expect(h.view.concealed.value).toBe(true)
      h.view.sync(h.chrome)
      expect(h.view.concealed.value).toBe(false)
      h.outside.focus()
      vi.advanceTimersByTime(260)
      expect(h.view.concealed.value).toBe(true)
      // Focus elsewhere when it starts: hidden at once.
      h.view.toggle()
      h.view.toggle()
      h.view.sync(h.chrome)
      expect(h.view.concealed.value).toBe(true)
    } finally { h.dispose() }
  })

  it('brings the chrome back while an agent needs you or something opened from it is open', () => {
    const h = harness()
    try {
      h.view.toggle()
      h.attention.value = true
      expect(h.view.concealed.value).toBe(false)
      h.attention.value = false
      expect(h.view.concealed.value).toBe(true)
      const menuOpen = ref(false)
      const cardOpen = ref(false)
      h.view.holdWhile(() => menuOpen.value)
      h.view.holdWhile(() => cardOpen.value)
      expect(h.view.concealed.value).toBe(true)
      cardOpen.value = true
      expect(h.view.concealed.value).toBe(false)
      cardOpen.value = false
      menuOpen.value = true
      expect(h.view.concealed.value).toBe(false)
      menuOpen.value = false
      expect(h.view.concealed.value).toBe(true)
    } finally { h.dispose() }
  })

  it('stops listening when its scope ends', () => {
    const removed = vi.spyOn(window, 'removeEventListener')
    const h = harness()
    h.dispose()
    expect(removed.mock.calls.map(([type]) => type)).toEqual(expect.arrayContaining(['blur', 'pointerdown', 'pointerup', 'dragstart']))
  })
})

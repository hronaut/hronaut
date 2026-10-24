import { afterEach, describe, expect, it, vi } from 'vitest'

const page = `
<main class="startup-notice" role="alertdialog">
  <h1 id="startup-notice-title"></h1>
  <p id="startup-notice-message"></p>
  <p id="startup-notice-detail"></p>
  <button id="startup-notice-quit" type="button"></button>
</main>`

function key(key: string, repeat = false): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, repeat, bubbles: true, cancelable: true })
  document.activeElement!.dispatchEvent(event)
  return event
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('startup notice page', () => {
  it('shows the notice it is given and quits from the keyboard only once the window has had the focus for a moment', async () => {
    vi.useFakeTimers()
    document.body.innerHTML = page
    window.history.replaceState(null, '', `/?${new URLSearchParams({ theme: 'cyberpunk', lang: 'de-DE', title: 'Titel', message: 'Nachricht', detail: 'Details', quit: 'Beenden' })}`)
    const close = vi.spyOn(window, 'close').mockImplementation(() => undefined)
    await import('../../src/renderer/src/startup-notice.js')

    const notice = document.querySelector<HTMLElement>('.startup-notice')!
    const quit = document.getElementById('startup-notice-quit')!
    expect(document.documentElement).toHaveAttribute('data-theme', 'cyberpunk')
    expect(document.documentElement).toHaveAttribute('lang', 'de-DE')
    expect(document.title).toBe('Titel')
    expect(document.getElementById('startup-notice-message')).toHaveTextContent('Nachricht')
    expect(quit).toHaveTextContent('Beenden')
    expect(quit).toHaveFocus()

    // A key held from the launcher: on Windows and Linux its first repeat here is not marked as one.
    expect(notice.dataset.armed).toBe('false')
    for (const name of ['Enter', ' ', 'Escape']) expect(key(name).defaultPrevented, name).toBe(true)
    quit.dispatchEvent(new MouseEvent('click', { detail: 0 }))
    expect(close).not.toHaveBeenCalled()

    vi.advanceTimersByTime(500)
    expect(notice.dataset.armed).toBe('true')
    expect(key('Enter', true).defaultPrevented).toBe(true)
    expect(close).not.toHaveBeenCalled()
    expect(key('Enter').defaultPrevented).toBe(false)
    quit.dispatchEvent(new MouseEvent('click', { detail: 0 }))
    expect(close).toHaveBeenCalledOnce()
    key('Escape')
    expect(close).toHaveBeenCalledTimes(2)

    // Coming back to the window waits again, and a pointer's click quits at once.
    window.dispatchEvent(new FocusEvent('focus'))
    expect(notice.dataset.armed).toBe('false')
    key('Escape')
    expect(close).toHaveBeenCalledTimes(2)
    quit.dispatchEvent(new MouseEvent('click', { detail: 1 }))
    expect(close).toHaveBeenCalledTimes(3)
  })
})

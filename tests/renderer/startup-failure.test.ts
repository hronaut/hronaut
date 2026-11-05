import { fireEvent } from '@testing-library/dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderStartupFailure } from '../../src/renderer/src/startup-failure.js'

describe('startup failure screen', () => {
  afterEach(() => document.body.replaceChildren())

  it('renders a bounded accessible error and retries once', async () => {
    const root = document.createElement('div')
    document.body.append(root)
    const retry = vi.fn()
    await renderStartupFailure(root, new Error("Error invoking remote method 'settings:get-renderer-state': Error: settings offline"), retry, 'en-US')

    const alert = root.querySelector<HTMLElement>('[role="alert"]')
    const button = root.querySelector<HTMLButtonElement>('button')
    expect(alert).toHaveAccessibleName('Hronaut could not start')
    expect(alert).toHaveTextContent('settings offline')
    expect(button).toHaveTextContent('Try again')
    expect(button).toHaveFocus()

    fireEvent.click(button!)
    fireEvent.click(button!)
    expect(retry).toHaveBeenCalledOnce()
  })

  it('speaks the system language with the Hronaut mark, since the chosen language is not loaded yet', async () => {
    const root = document.createElement('div')
    document.body.append(root)
    await renderStartupFailure(root, new Error("Error invoking remote method 'settings:get-renderer-state': Error: "), vi.fn(), 'uk-UA')

    expect(document.documentElement.lang).toBe('uk-UA')
    expect(root.querySelector('[role="alert"]')).toHaveAccessibleName('Не вдалося запустити Hronaut')
    expect(root.querySelector('code')).toHaveTextContent('Служба налаштувань інтерфейсу недоступна.')
    expect(root.querySelector('button')).toHaveTextContent('Спробувати ще раз')
    expect(root.querySelector('.startup-failure-mark')).toHaveTextContent('H')
  })

  it('inserts error text without interpreting markup', async () => {
    const root = document.createElement('div')
    document.body.append(root)
    await renderStartupFailure(root, '<img src=x onerror=alert(1)>', vi.fn(), 'en-US')

    expect(root.querySelector('img')).toBeNull()
    expect(root.querySelector('code')).toHaveTextContent('<img src=x onerror=alert(1)>')
  })

  it('speaks English when the system language cannot be loaded', async () => {
    vi.resetModules()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.doMock('../../src/shared/locales/uk-UA.js', () => { throw new Error('missing') })
    try {
      const { renderStartupFailure: render } = await import('../../src/renderer/src/startup-failure.js')
      const root = document.createElement('div')
      document.body.append(root)
      await render(root, new Error('settings offline'), vi.fn(), 'uk-UA')

      expect(document.documentElement.lang).toBe('en-US')
      expect(root.querySelector('[role="alert"]')).toHaveAccessibleName('Hronaut could not start')
    } finally {
      vi.doUnmock('../../src/shared/locales/uk-UA.js')
      vi.restoreAllMocks()
    }
  })
})

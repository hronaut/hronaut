import { fireEvent } from '@testing-library/dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderStartupFailure } from '../../src/renderer/src/startup-failure.js'

describe('startup failure screen', () => {
  afterEach(() => document.body.replaceChildren())

  it('renders a bounded accessible error and retries once', () => {
    const root = document.createElement('div')
    document.body.append(root)
    const retry = vi.fn()
    renderStartupFailure(root, new Error("Error invoking remote method 'settings:get-renderer-state': Error: settings offline"), retry)

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

  it('inserts error text without interpreting markup', () => {
    const root = document.createElement('div')
    document.body.append(root)
    renderStartupFailure(root, '<img src=x onerror=alert(1)>', vi.fn())

    expect(root.querySelector('img')).toBeNull()
    expect(root.querySelector('code')).toHaveTextContent('<img src=x onerror=alert(1)>')
  })
})

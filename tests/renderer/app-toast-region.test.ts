import { fireEvent, render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import AppToastRegion from '../../src/renderer/src/components/AppToastRegion.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'

describe('AppToastRegion', () => {
  it('renders notification semantics and emits dismiss requests', async () => {
    const view = render(AppToastRegion, {
      global: { plugins: [createHronautI18n('en-US')] },
      props: {
        home: true,
        toasts: [{ id: 4, tone: 'error', title: 'Reload failed', message: 'Renderer unavailable' }]
      }
    })

    expect(view.container.querySelector('.app-toast-region')).toHaveClass('home')
    expect(view.container.querySelector('.app-toast-region')).toHaveAttribute('aria-label', 'Application notifications')
    expect(screen.getByRole('alert', { name: 'Reload failed' })).toHaveTextContent('Renderer unavailable')
    const dismiss = screen.getByRole('button', { name: 'Dismiss Reload failed' })
    await fireEvent.focusIn(dismiss)
    expect(view.emitted().retain).toEqual([[4]])
    await userEvent.setup().click(screen.getByRole('button', { name: 'Dismiss Reload failed' }))

    expect(view.emitted().dismiss).toEqual([[4]])
  })

  it('centers toasts over the page column so tabs in the rail stay clickable', () => {
    const toasts = [{ id: 5, tone: 'success' as const, title: 'Tab closed', message: 'Example' }]
    const view = render(AppToastRegion, {
      global: { plugins: [createHronautI18n('en-US')] },
      props: { home: false, toasts, railWidth: 248 }
    })

    expect(view.container.querySelector<HTMLElement>('.app-toast-region')?.style.getPropertyValue('--toast-rail-width')).toBe('248px')
  })

  it('spans the window when there is no tab rail', () => {
    const view = render(AppToastRegion, {
      global: { plugins: [createHronautI18n('en-US')] },
      props: { home: false, toasts: [] }
    })

    expect(view.container.querySelector<HTMLElement>('.app-toast-region')?.style.getPropertyValue('--toast-rail-width')).toBe('0px')
  })
})

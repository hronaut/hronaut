import { fireEvent, render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import AppToastRegion from '../../src/renderer/src/components/AppToastRegion.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'

const styles = readFileSync(join(process.cwd(), 'src/renderer/src/components/AppToastRegion.vue'), 'utf8')

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

  it('sits in the toolbar row under tabs along the top, so those tabs stay clickable', () => {
    const toasts = [{ id: 6, tone: 'success' as const, title: 'Tab closed', message: 'Example' }]
    const view = render(AppToastRegion, {
      global: { plugins: [createHronautI18n('en-US')] },
      props: { home: false, toasts, belowTabStrip: true }
    })

    expect(view.container.querySelector('.app-toast-region')).toHaveClass('below-tab-strip')
    expect(styles).toMatch(/\.app-toast-region\.below-tab-strip\s*\{\s*top:\s*52px;\s*\}/u)
  })

  it('steps aside while the address field it would cover has focus, and keeps the toast', async () => {
    const toasts = [{ id: 7, tone: 'success' as const, title: 'Tab closed', message: 'Example', action: { label: 'Undo', ariaLabel: 'Undo closing Example' } }]
    const view = render(AppToastRegion, {
      global: { plugins: [createHronautI18n('en-US')] },
      props: { home: false, toasts, yielding: true }
    })

    expect(view.container.querySelector('.app-toast-region')).toHaveClass('yielding')
    expect(styles).toMatch(/\.app-toast-region\.yielding\s*\{\s*visibility:\s*hidden;\s*\}/u)
    await view.rerender({ home: false, toasts, yielding: false })
    expect(view.container.querySelector('.app-toast-region')).not.toHaveClass('yielding')
    expect(screen.getByRole('button', { name: 'Undo closing Example' })).toBeInTheDocument()
    expect(view.emitted().dismiss).toBeUndefined()
  })

  it('spans the window when there is no tab rail', () => {
    const view = render(AppToastRegion, {
      global: { plugins: [createHronautI18n('en-US')] },
      props: { home: false, toasts: [] }
    })

    expect(view.container.querySelector<HTMLElement>('.app-toast-region')?.style.getPropertyValue('--toast-rail-width')).toBe('0px')
  })
})

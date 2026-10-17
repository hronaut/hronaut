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

  it('keeps a copy for screen readers and the keyboard while main draws the toast above the page', async () => {
    const toasts = [{ id: 6, tone: 'success' as const, title: 'Tab closed', message: 'Example', action: { label: 'Undo', ariaLabel: 'Undo: Tab closed' } }]
    const view = render(AppToastRegion, {
      global: { plugins: [createHronautI18n('en-US')] },
      props: { home: false, toasts, mirrored: true }
    })

    expect(view.container.querySelector('.app-toast-region')).toHaveClass('mirrored')
    // Out of sight and out of the pointer's way, but still announced and reachable with Tab.
    expect(styles).toMatch(/\.app-toast-region\.mirrored \{[^}]*width: 1px;[^}]*height: 1px;[^}]*overflow: hidden;[^}]*clip-path: inset\(50%\);/u)
    expect(styles).toMatch(/\.app-toast-region\.mirrored \.app-toast \{ pointer-events: none; \}/u)
    expect(screen.getByRole('status', { name: 'Tab closed' })).toHaveTextContent('Example')
    const undo = screen.getByRole('button', { name: 'Undo: Tab closed' })
    const dismiss = screen.getByRole('button', { name: 'Dismiss Tab closed' })

    // Main draws the focus ring on its copy of whichever button has focus here.
    await fireEvent.focusIn(undo)
    await fireEvent.focusOut(undo)
    await fireEvent.focusIn(dismiss)
    await fireEvent.focusOut(dismiss)
    expect(view.emitted().focusPart).toEqual([['action'], [null], ['dismiss'], [null]])
    // Keyboard focus in the copy holds the toast, as it does in a visible one.
    expect(view.emitted().retain).toEqual([[6], [6]])

    // Where main cannot draw it, the shell shows its own copy over the page column again.
    await view.rerender({ home: false, toasts, mirrored: false })
    expect(view.container.querySelector('.app-toast-region')).not.toHaveClass('mirrored')
    expect(styles).not.toMatch(/below-tab-strip|yielding|anchor\(/u)
  })

  it('spans the window when there is no tab rail', () => {
    const view = render(AppToastRegion, {
      global: { plugins: [createHronautI18n('en-US')] },
      props: { home: false, toasts: [] }
    })

    expect(view.container.querySelector<HTMLElement>('.app-toast-region')?.style.getPropertyValue('--toast-rail-width')).toBe('0px')
  })
})

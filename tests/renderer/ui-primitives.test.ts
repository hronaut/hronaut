import { render, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import UiButton from '../../src/renderer/src/ui/UiButton.vue'
import UiField from '../../src/renderer/src/ui/UiField.vue'
import UiNotice from '../../src/renderer/src/ui/UiNotice.vue'

describe('UI primitives', () => {
  it('exposes button state through native interaction semantics', () => {
    render(UiButton, {
      props: { variant: 'primary', busy: true },
      slots: { default: 'Saving changes' }
    })

    const button = screen.getByRole('button', { name: 'Saving changes' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toHaveClass('ui-button--primary')
  })

  it('preserves established feature styling through native mode', () => {
    render(UiButton, {
      props: { native: true },
      attrs: { class: 'panel-close' },
      slots: { default: 'Close' }
    })

    const button = screen.getByRole('button', { name: 'Close' })
    expect(button).toHaveClass('panel-close')
    expect(button).not.toHaveClass('ui-button')
    expect(button).toHaveAttribute('type', 'button')
  })

  it('associates field labels and reports errors accessibly', () => {
    render(UiField, {
      props: {
        label: 'Workspace name',
        forId: 'workspace-name',
        error: 'A workspace name is required.'
      },
      slots: { default: '<input id="workspace-name" />' }
    })

    expect(screen.getByLabelText('Workspace name')).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent('A workspace name is required.')
  })

  it('announces danger notices without making informational notices intrusive', () => {
    const danger = render(UiNotice, {
      props: { tone: 'danger' },
      slots: { default: 'Connection failed.' }
    })
    expect(screen.getByRole('alert')).toHaveTextContent('Connection failed.')
    danger.unmount()

    render(UiNotice, {
      props: { tone: 'neutral' },
      slots: { default: 'Connection details.' }
    })
    expect(screen.getByText('Connection details.')).not.toHaveAttribute('role')
  })
})

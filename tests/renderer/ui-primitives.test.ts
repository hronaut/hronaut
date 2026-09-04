import { fireEvent, render, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import UiButton from '../../src/renderer/src/ui/UiButton.vue'
import UiDialog from '../../src/renderer/src/ui/UiDialog.vue'
import UiField from '../../src/renderer/src/ui/UiField.vue'
import UiInput from '../../src/renderer/src/ui/UiInput.vue'
import UiMenu from '../../src/renderer/src/ui/UiMenu.vue'
import UiNotice from '../../src/renderer/src/ui/UiNotice.vue'
import UiSegmentedControl from '../../src/renderer/src/ui/UiSegmentedControl.vue'
import UiSwitch from '../../src/renderer/src/ui/UiSwitch.vue'
import UiTabs from '../../src/renderer/src/ui/UiTabs.vue'

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

  it('supports icon slots, pressed state, and an accessible busy label', () => {
    render(UiButton, {
      props: { pressed: true, busy: true, loadingLabel: 'Saving' },
      slots: { default: 'Save', startIcon: '<svg data-testid="icon" />' }
    })

    const button = screen.getByRole('button', { name: 'Saving' })
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(button).toBeDisabled()
    expect(screen.queryByTestId('icon')).not.toBeInTheDocument()
  })

  it('keeps application-owned controls inside the shared behavior boundary', () => {
    render(UiButton, {
      props: { appearance: 'application' },
      attrs: { class: 'tab-close' },
      slots: { default: 'Close' }
    })

    const button = screen.getByRole('button', { name: 'Close' })
    expect(button).toHaveClass('ui-button', 'ui-button--application', 'tab-close')
    expect(button).toHaveAttribute('type', 'button')
  })

  it('generates field relationships and supplies them to controls', () => {
    render(UiField, {
      props: {
        label: 'Workspace name',
        error: 'A workspace name is required.',
        required: true
      },
      slots: { default: () => h(UiInput) }
    })

    const input = screen.getByRole('textbox', { name: /Workspace name/ })
    const error = screen.getByRole('alert')
    expect(input).toBeRequired()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAttribute('aria-describedby', error.id)
  })

  it('announces danger notices without making informational notices intrusive', () => {
    const danger = render(UiNotice, {
      props: { tone: 'danger', role: 'alert' },
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

  it('exposes switch state with native switch semantics', async () => {
    render(UiSwitch, { props: { label: 'Require authentication' } })
    const control = screen.getByRole('switch', { name: 'Require authentication' })
    await fireEvent.click(control)
    expect(control).toBeChecked()
  })

  it('supports keyboard tab selection', async () => {
    render(UiTabs, {
      props: {
        modelValue: 'general',
        items: [{ id: 'general', label: 'General' }, { id: 'privacy', label: 'Privacy' }]
      }
    })
    const general = screen.getByRole('tab', { name: 'General' })
    general.focus()
    await fireEvent.keyDown(general, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'Privacy' })).toHaveAttribute('aria-selected', 'true')
  })

  it('supports arrow-key selection in segmented controls', async () => {
    render(UiSegmentedControl, {
      props: {
        modelValue: 'comfortable',
        label: 'Density',
        options: [{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]
      }
    })
    const comfortable = screen.getByRole('radio', { name: 'Comfortable' })
    comfortable.focus()
    await fireEvent.keyDown(comfortable, { key: 'ArrowRight' })
    expect(screen.getByRole('radio', { name: 'Compact' })).toHaveAttribute('aria-checked', 'true')
  })

  it('opens menus from the keyboard and returns focus after selection', async () => {
    const menu = render(UiMenu, {
      props: {
        open: false,
        label: 'Workspace actions',
        items: [{ id: 'rename', label: 'Rename' }, { id: 'delete', label: 'Delete', danger: true }],
        'onUpdate:open': (open: boolean) => menu.rerender({ open })
      }
    })
    const trigger = screen.getByRole('button', { name: 'Workspace actions' })
    trigger.focus()
    await fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    const rename = await screen.findByRole('menuitem', { name: 'Rename' })
    expect(rename).toHaveFocus()
    await fireEvent.click(rename)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('labels dialogs and restores focus after dismissal', async () => {
    const trigger = document.createElement('button')
    trigger.textContent = 'Open'
    document.body.append(trigger)
    trigger.focus()
    const dialog = render(UiDialog, {
      props: { open: true, title: 'Create workspace' },
      slots: { default: '<button>First action</button>' }
    })

    expect(screen.getByRole('dialog', { name: 'Create workspace' })).toBeVisible()
    await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await dialog.rerender({ open: false, title: 'Create workspace' })
    expect(trigger).toHaveFocus()
    trigger.remove()
  })
})

import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import HelpDialog from '../../src/renderer/src/components/HelpDialog.vue'
import { useHelpDialogController } from '../../src/renderer/src/composables/useHelpDialogController.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'

function renderDialog() {
  const controller = useHelpDialogController({ beforeOpen: vi.fn() })
  const openUrl = vi.fn(async () => undefined)
  const openSupportSettings = vi.fn()
  const reportLayout = vi.fn()
  render(HelpDialog, {
    global: { plugins: [createHronautI18n('en-US')] },
    props: {
      controller,
      shortcuts: [{ label: 'Focus the address bar', keys: ['Ctrl/Cmd', 'L'] }],
      currentVersion: '1.7.2',
      openUrl,
      openSupportSettings,
      reportLayout
    }
  })
  return { controller, openSupportSettings, openUrl, reportLayout }
}

describe('HelpDialog', () => {
  it('renders shortcuts, focuses the modal, and restores invoking focus on close', async () => {
    const trigger = document.createElement('button')
    document.body.append(trigger)
    trigger.focus()
    const { controller, reportLayout } = renderDialog()

    controller.openDialog('shortcuts')
    const dialog = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })
    await vi.waitFor(() => expect(dialog).toHaveFocus())
    expect(dialog).toHaveTextContent('Focus the address bar')

    await userEvent.setup().click(screen.getByRole('button', { name: 'Close help' }))
    await vi.waitFor(() => expect(trigger).toHaveFocus())
    expect(reportLayout).toHaveBeenCalled()
    trigger.remove()
    controller.dispose()
  })

  it('renders About actions and delegates navigation', async () => {
    const { controller, openSupportSettings, openUrl } = renderDialog()
    controller.openDialog('about')

    const dialog = await screen.findByRole('dialog', { name: 'About Hronaut' })
    expect(dialog).toHaveTextContent('Hronaut 1.7.2')
    await userEvent.setup().click(screen.getByRole('button', { name: 'GitHub repository' }))
    expect(openUrl).toHaveBeenCalledWith('https://github.com/hronaut/hronaut')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Commercial license' }))
    expect(openSupportSettings).toHaveBeenCalledOnce()
    controller.dispose()
  })
})

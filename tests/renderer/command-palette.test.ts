import { fireEvent, render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import CommandPalette from '../../src/renderer/src/components/CommandPalette.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'

describe('CommandPalette', () => {
  it('returns focus to its invoking control after close', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const trigger = document.createElement('button')
    document.body.append(trigger)
    trigger.focus()
    const view = render(CommandPalette, {
      global: { plugins: [createHronautI18n('en-US')] },
      props: {
        open: false,
        websiteAvailable: false,
        formatNumber: String,
        runCommand: vi.fn(),
        reportCommandError: vi.fn()
      }
    })

    await view.rerender({ open: true })
    await screen.findByRole('dialog', { name: 'Commands' })
    screen.getByRole('combobox', { name: 'Search commands' }).focus()
    await view.rerender({ open: false })

    await vi.waitFor(() => expect(trigger).toHaveFocus())
    trigger.remove()
  })

  it('owns accessible filtering and delegates the selected command', async () => {
    const runCommand = vi.fn(async () => undefined)
    const view = render(CommandPalette, {
      global: { plugins: [createHronautI18n('en-US')] },
      props: {
        open: true,
        websiteAvailable: false,
        formatNumber: String,
        runCommand,
        reportCommandError: vi.fn()
      }
    })
    const user = userEvent.setup()
    const search = screen.getByRole('combobox', { name: 'Search commands' })

    expect(screen.getByRole('dialog', { name: 'Commands' })).toBeVisible()
    await user.type(search, 'settings')
    expect(screen.getByRole('option', { name: /Open Settings/ })).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Enter}')
    await vi.waitFor(() => expect(runCommand).toHaveBeenCalledWith('settings'))
    expect(view.emitted()['update:open']?.at(-1)).toEqual([false])
  })

  it('reports a rejected selected command through the shell error boundary', async () => {
    const failure = new Error('downloads unavailable')
    const runCommand = vi.fn().mockRejectedValue(failure)
    const reportCommandError = vi.fn()
    const view = render(CommandPalette, {
      global: { plugins: [createHronautI18n('en-US')] },
      props: {
        open: true,
        websiteAvailable: false,
        formatNumber: String,
        runCommand,
        reportCommandError
      }
    })
    const user = userEvent.setup()

    await user.type(screen.getByRole('combobox', { name: 'Search commands' }), 'downloads')
    await user.keyboard('{Enter}')

    await vi.waitFor(() => expect(reportCommandError).toHaveBeenCalledWith(failure, 'downloads'))
    expect(view.emitted()['update:open']?.at(-1)).toEqual([false])
  })

  it('ignores pointer events caused by a live command-list reflow', async () => {
    let now = 1_000
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now)
    const view = render(CommandPalette, {
      global: { plugins: [createHronautI18n('en-US')] },
      props: {
        open: true,
        websiteAvailable: true,
        formatNumber: String,
        runCommand: vi.fn(),
        reportCommandError: vi.fn()
      }
    })
    const settings = screen.getByRole('option', { name: /Open Settings/ })
    const history = screen.getByRole('option', { name: /Show browsing history/ })

    await fireEvent.pointerMove(settings, { clientX: 40, clientY: 80 })
    expect(settings).toHaveAttribute('aria-selected', 'true')
    await view.rerender({ websiteAvailable: false })
    await fireEvent.pointerMove(history, { clientX: 40, clientY: 80 })
    expect(settings).toHaveAttribute('aria-selected', 'true')
    await fireEvent.pointerMove(history, { clientX: 41, clientY: 80 })
    expect(settings).toHaveAttribute('aria-selected', 'true')
    now += 151
    await fireEvent.pointerMove(history, { clientX: 42, clientY: 80 })
    expect(history).toHaveAttribute('aria-selected', 'true')
    nowSpy.mockRestore()
  })

  it('accepts the first intentional pointer move after opening over a recently changed list', async () => {
    const now = 1_000
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now)
    const view = render(CommandPalette, {
      global: { plugins: [createHronautI18n('en-US')] },
      props: {
        open: false,
        websiteAvailable: false,
        formatNumber: String,
        runCommand: vi.fn(),
        reportCommandError: vi.fn()
      }
    })

    await view.rerender({ websiteAvailable: true })
    await view.rerender({ open: true })
    const settings = screen.getByRole('option', { name: /Open Settings/ })
    await fireEvent.pointerMove(settings, { clientX: 40, clientY: 80 })

    expect(settings).toHaveAttribute('aria-selected', 'true')
    nowSpy.mockRestore()
  })
})

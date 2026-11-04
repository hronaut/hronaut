import { fireEvent, render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CommandPalette from '../../src/renderer/src/features/command-palette/CommandPalette.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'

describe('CommandPalette', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

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
    screen.getByRole('combobox', { name: 'Search commands, tabs and pages' }).focus()
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
    const search = screen.getByRole('combobox', { name: 'Search commands, tabs and pages' })

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

    await user.type(screen.getByRole('combobox', { name: 'Search commands, tabs and pages' }), 'downloads')
    await user.keyboard('{Enter}')

    await vi.waitFor(() => expect(reportCommandError).toHaveBeenCalledWith(failure, 'downloads'))
    expect(view.emitted()['update:open']?.at(-1)).toEqual([false])
  })

  it('ignores pointer events caused by a live command-list reflow', async () => {
    let now = 1_000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
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

    await fireEvent.pointerMove(settings, { clientX: 40, clientY: 76 })
    await fireEvent.pointerMove(settings, { clientX: 40, clientY: 80 })
    expect(settings).toHaveAttribute('aria-selected', 'true')
    await view.rerender({ websiteAvailable: false })
    await fireEvent.pointerMove(history, { clientX: 40, clientY: 80 })
    expect(settings).toHaveAttribute('aria-selected', 'true')
    await fireEvent.pointerMove(history, { clientX: 41, clientY: 80 })
    expect(settings).toHaveAttribute('aria-selected', 'true')
    now += 151
    // The guard counts on the monotonic clock, so a wall clock that steps back meanwhile does not extend it.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() - 3_600_000)
    await fireEvent.pointerMove(history, { clientX: 42, clientY: 80 })
    expect(history).toHaveAttribute('aria-selected', 'true')

    // The event a reflow sends can come after the guard, where the pointer rests rather than where it last moved over a
    // row, as for a pointer resting beside the rows or, under Xvfb, the system's pointer beside Playwright's. The first
    // event after a reflow only says where the pointer rests, however late it comes.
    await view.rerender({ websiteAvailable: true })
    now += 151
    await fireEvent.pointerMove(settings, { clientX: 60, clientY: 90 })
    expect(history).toHaveAttribute('aria-selected', 'true')
    await fireEvent.pointerMove(settings, { clientX: 60, clientY: 94 })
    expect(settings).toHaveAttribute('aria-selected', 'true')
  })

  it('takes the first pointer event after opening as where the pointer rests, and follows it once it moves', async () => {
    const now = 1_000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
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
    const first = screen.getAllByRole('option')[0]
    expect(first).toHaveAttribute('aria-selected', 'true')
    // Opened with a shortcut, the palette hid the pages under it and the window was handed the pointer where it rested,
    // over a row: that row was taken, and Enter ran it instead of the command the palette opened on.
    await fireEvent.pointerMove(settings, { clientX: 40, clientY: 80 })
    expect(first).toHaveAttribute('aria-selected', 'true')
    // A list changed just before it opened does not hold back a pointer that moves.
    await fireEvent.pointerMove(settings, { clientX: 40, clientY: 84 })
    expect(settings).toHaveAttribute('aria-selected', 'true')
  })

  it('remembers where the pointer rests beside the rows, and starts afresh each time it opens', async () => {
    const now = 1_000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
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
    const settings = () => screen.getByRole('option', { name: /Open Settings/ })
    const history = () => screen.getByRole('option', { name: /Show browsing history/ })
    const selectedId = () => screen.getAllByRole('option').find((option) => option.getAttribute('aria-selected') === 'true')?.id
    await fireEvent.pointerMove(settings(), { clientX: 40, clientY: 76 })
    await fireEvent.pointerMove(settings(), { clientX: 40, clientY: 80 })
    expect(settings()).toHaveAttribute('aria-selected', 'true')

    // The pointer leaves the rows to rest beside them, and the keyboard goes on to the next command, scrolling a row
    // under the resting pointer, which the window hands an event where it rests.
    await fireEvent.pointerMove(screen.getByRole('dialog').parentElement!, { clientX: 900, clientY: 40 })
    await fireEvent.keyDown(screen.getByRole('combobox', { name: 'Search commands, tabs and pages' }), { key: 'ArrowDown' })
    const chosen = selectedId()
    expect(chosen).not.toBe(settings().id)
    await fireEvent.pointerMove(history(), { clientX: 900, clientY: 40 })
    expect(selectedId()).toBe(chosen)

    // Opened again with its shortcut under a pointer resting elsewhere than when it closed.
    await view.rerender({ open: false })
    await view.rerender({ open: true })
    const opened = selectedId()
    await fireEvent.pointerMove(history(), { clientX: 60, clientY: 90 })
    expect(selectedId()).toBe(opened)
    await fireEvent.pointerMove(history(), { clientX: 60, clientY: 94 })
    expect(history()).toHaveAttribute('aria-selected', 'true')
  })
})

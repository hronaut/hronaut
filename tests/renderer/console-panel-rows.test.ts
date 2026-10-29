import { render, screen, within } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import ConsolePanel from '../../src/renderer/src/features/console/ConsolePanel.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import { filterConsoleMessages, mergeRepeatedConsoleMessage } from '../../src/shared/console-messages.js'
import type { BrowserConsoleMessage } from '../../src/shared/types.js'

const global = { plugins: [createHronautI18n('en-US')] }

const failure: BrowserConsoleMessage = {
  kind: 'console',
  timestamp: '2026-08-21T12:00:00.000Z',
  level: 'error',
  message: 'checkout failed',
  lineNumber: 12,
  columnNumber: 4,
  sourceId: 'https://example.test/app.js',
  stack: [
    { functionName: 'submitOrder', url: 'https://example.test/app.js', lineNumber: 12, columnNumber: 4 },
    { functionName: 'onClick', url: 'https://example.test/app.js', lineNumber: 40, columnNumber: 2 }
  ]
}

const heartbeat: BrowserConsoleMessage = {
  kind: 'console',
  timestamp: '2026-08-21T12:00:01.000Z',
  level: 'info',
  message: 'heartbeat',
  lineNumber: 80,
  columnNumber: 1,
  sourceId: 'https://example.test/poll.js'
}

function props(messages: BrowserConsoleMessage[]) {
  return {
    open: true,
    dock: 'right' as const,
    search: '',
    excludeText: '',
    level: 'all' as const,
    liveUpdatesPaused: false,
    state: 'ready' as const,
    messages,
    // The controller shows the newest message first, as the Console panel always has.
    filteredMessages: filterConsoleMessages(messages, '', 'all'),
    error: '',
    copied: null,
    copiedEntryKey: null,
    messageCounts: { error: 1, warning: 0, info: 0, verbose: 0 },
    eventCount: messages.length,
    filteredEventCount: messages.length,
    preserveLogs: false,
    preservationBusy: false,
    locale: 'en-US' as const
  }
}

function failureRow(): HTMLElement {
  const row = screen.getByText('checkout failed').closest('article')
  if (!(row instanceof HTMLElement)) throw new Error('missing failure row')
  return row
}

describe('Console panel rows across live updates', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('keeps an expanded call stack open while a newer message arrives above it', async () => {
    const view = render(ConsolePanel, { global, props: props([failure]) })
    const user = userEvent.setup()
    const stack = failureRow().querySelector('details.console-stack')
    if (!(stack instanceof HTMLDetailsElement)) throw new Error('missing call stack')
    await user.click(within(failureRow()).getByText('Call stack'))
    expect(stack.open).toBe(true)

    await view.rerender(props([failure, heartbeat]))

    expect(failureRow().querySelector('details.console-stack')).toBe(stack)
    expect(stack.open).toBe(true)
  })

  it('keeps an expanded call stack open while its message repeats', async () => {
    const view = render(ConsolePanel, { global, props: props([failure]) })
    const user = userEvent.setup()
    const stack = failureRow().querySelector('details.console-stack')
    if (!(stack instanceof HTMLDetailsElement)) throw new Error('missing call stack')
    await user.click(within(failureRow()).getByText('Call stack'))

    const repeated = mergeRepeatedConsoleMessage(failure, { ...failure, timestamp: '2026-08-21T12:00:02.000Z' })
    if (!repeated) throw new Error('fixture did not repeat')
    await view.rerender(props([repeated]))

    expect(within(failureRow()).getByText('×2')).toBeVisible()
    expect(failureRow().querySelector('details.console-stack')).toBe(stack)
    expect(stack.open).toBe(true)
  })

  it('keeps the focus on a Copy button while a newer message arrives above it', async () => {
    const view = render(ConsolePanel, { global, props: props([failure]) })
    const copy = within(failureRow()).getByRole('button', { name: 'Copy Console entry' })
    copy.focus()

    await view.rerender(props([failure, heartbeat]))

    expect(within(failureRow()).getByRole('button', { name: 'Copy Console entry' })).toBe(copy)
    expect(copy).toHaveFocus()
  })

  it('keeps identical messages logged in the same millisecond as separate rows', async () => {
    const view = render(ConsolePanel, { global, props: props([heartbeat, { ...heartbeat }]) })
    expect(screen.getAllByText('heartbeat')).toHaveLength(2)
    const [newer, older] = screen.getAllByText('heartbeat').map((element) => element.closest('article'))

    await view.rerender(props([heartbeat, { ...heartbeat }, failure]))

    const [stillNewer, stillOlder] = screen.getAllByText('heartbeat').map((element) => element.closest('article'))
    expect(stillNewer).toBe(newer)
    expect(stillOlder).toBe(older)
  })
})

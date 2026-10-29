import { fireEvent, render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { ref, type Ref } from 'vue'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import AppToastRegion from '../../src/renderer/src/components/AppToastRegion.vue'
import { useAppToastController } from '../../src/renderer/src/composables/useAppToastController.js'
import { useUndoToasts } from '../../src/renderer/src/composables/useUndoToasts.js'
import { useWorkspaceEditorController } from '../../src/renderer/src/features/workspaces/useWorkspaceEditorController.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowserSavedTabGroupState, BrowserState, BrowserTabGroupState } from '../../src/shared/types.js'
import { MAX_ARCHIVED_WORKSPACES, UNDO_OFFER_MS, type UndoOffer } from '../../src/shared/undo.js'

// Regression coverage for the renderer side of #863 (Undo toasts), deferred to the redesign QA pass.

const TOKEN_A = '123e4567-e89b-42d3-a456-426614174000'
const TOKEN_B = '123e4567-e89b-42d3-a456-426614174001'

const i18n = createHronautI18n('en-US')
const globalT = i18n.global.t as (key: string, values?: Record<string, unknown>, plural?: number) => string
const translate = (key: string, values?: Record<string, unknown>, plural?: number): string => (
  plural === undefined ? globalT(key, values ?? {}) : globalT(key, values ?? {}, plural)
)

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('app toast controller action hooks', () => {
  it('calls onReplaced, never onClose, when another message takes the slot, and keeps the slot id', async () => {
    vi.useFakeTimers()
    const controller = useAppToastController()
    const onClose = vi.fn()
    const onReplaced = vi.fn()
    const run = vi.fn()

    const id = controller.show('success', 'Tab closed', 'Example', { action: { label: 'Undo', run }, duration: UNDO_OFFER_MS, onClose, onReplaced })
    const replacement = controller.show('info', 'Link copied', 'https://example.test')

    expect(replacement).toBe(id)
    expect(onReplaced).toHaveBeenCalledOnce()
    expect(onClose).not.toHaveBeenCalled()
    expect(controller.toasts.value).toEqual([{ id, tone: 'info', title: 'Link copied', message: 'https://example.test' }])
    // The replaced toast's hooks are gone: its old action no longer runs and timing out the newer one is not its close.
    controller.act(id!)
    expect(run).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(onClose).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('runs the action once through act and skips onClose', () => {
    const controller = useAppToastController()
    const run = vi.fn()
    const onClose = vi.fn()
    const id = controller.show('success', 'Tab closed', 'Example', { action: { label: 'Undo', run }, onClose })!

    controller.act(id)
    controller.act(id)

    expect(run).toHaveBeenCalledOnce()
    expect(onClose).not.toHaveBeenCalled()
    expect(controller.toasts.value).toEqual([])
    controller.dispose()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('leaves a toast without an action in place when act is asked for it', () => {
    const controller = useAppToastController()
    const onClose = vi.fn()
    const id = controller.show('info', 'Saved', 'Ready', { onClose })!

    controller.act(id)

    expect(controller.toasts.value).toHaveLength(1)
    expect(onClose).not.toHaveBeenCalled()
    controller.dispose()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onRetain once, stops the time, and carries the hold over to a replacement', async () => {
    vi.useFakeTimers()
    const controller = useAppToastController()
    const onRetain = vi.fn()
    const id = controller.show('success', 'Tab closed', 'Example', { action: { label: 'Undo', run: vi.fn() }, duration: UNDO_OFFER_MS, onRetain })!

    controller.retain(id)
    controller.retain(id)
    expect(onRetain).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(controller.toasts.value[0]?.title).toBe('Tab closed')

    const nextRetain = vi.fn()
    controller.show('success', 'Workspace closed', 'Research', { duration: UNDO_OFFER_MS, onRetain: nextRetain })
    expect(nextRetain).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(controller.toasts.value[0]?.title).toBe('Workspace closed')
    controller.dispose()
  })

  it('restarts the full time on release of a held toast and ignores release of one that is not held', async () => {
    vi.useFakeTimers()
    const controller = useAppToastController()
    const onClose = vi.fn()
    const id = controller.show('success', 'Tab closed', 'Example', { duration: UNDO_OFFER_MS, onClose })!

    await vi.advanceTimersByTimeAsync(5_000)
    controller.release(id)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(controller.toasts.value).toEqual([])
    expect(onClose).toHaveBeenCalledOnce()

    const heldClose = vi.fn()
    const held = controller.show('success', 'Bookmark removed', 'Docs', { duration: UNDO_OFFER_MS, onClose: heldClose })!
    controller.retain(held)
    await vi.advanceTimersByTimeAsync(30_000)
    controller.release(held)
    await vi.advanceTimersByTimeAsync(UNDO_OFFER_MS - 1)
    expect(controller.toasts.value[0]?.title).toBe('Bookmark removed')
    await vi.advanceTimersByTimeAsync(1)
    expect(controller.toasts.value).toEqual([])
    expect(heldClose).toHaveBeenCalledOnce()
    controller.dispose()
  })

  it('closes remaining hooks once on disposal and returns no id afterwards', () => {
    const controller = useAppToastController()
    const onClose = vi.fn()
    const onReplaced = vi.fn()
    controller.show('success', 'Tab closed', 'Example', { onClose, onReplaced })

    controller.dispose()
    controller.dispose()

    expect(onClose).toHaveBeenCalledOnce()
    expect(onReplaced).not.toHaveBeenCalled()
    expect(controller.show('info', 'Late', 'After teardown')).toBeUndefined()
  })

  it('bounds the action label and its accessible name', () => {
    const controller = useAppToastController()
    controller.show('success', 'Tab closed', 'Example', { action: { label: 'U'.repeat(60), ariaLabel: 'A'.repeat(300), run: vi.fn() } })

    expect(controller.toasts.value[0]?.action).toEqual({ label: 'U'.repeat(40), ariaLabel: 'A'.repeat(200) })
    controller.dispose()
  })
})

describe('AppToastRegion action toasts', () => {
  function renderRegion(withAction: boolean) {
    return render(AppToastRegion, {
      global: { plugins: [createHronautI18n('en-US')] },
      props: {
        home: false,
        toasts: [{
          id: 7,
          tone: 'success' as const,
          title: 'Tab closed',
          message: 'Example',
          ...(withAction ? { action: { label: 'Undo', ariaLabel: 'Undo: Tab closed' } } : {})
        }]
      }
    })
  }

  it('draws the Undo button, marks the toast and emits act', async () => {
    const view = renderRegion(true)
    const toast = screen.getByRole('status', { name: 'Tab closed' })
    const undo = screen.getByRole('button', { name: 'Undo: Tab closed' })

    expect(toast).toHaveClass('app-toast', 'success', 'with-action')
    expect(undo).toHaveTextContent('Undo')
    expect(undo).toHaveAttribute('data-testid', 'app-toast-action')
    await userEvent.setup().click(undo)

    expect(view.emitted().act).toEqual([[7]])
    expect(view.emitted().dismiss).toBeUndefined()
  })

  it('holds an action toast while the pointer is on it and lets it go when the pointer leaves', async () => {
    const view = renderRegion(true)
    const toast = screen.getByRole('status', { name: 'Tab closed' })

    await fireEvent.pointerEnter(toast)
    expect(view.emitted().retain).toEqual([[7]])
    await fireEvent.pointerLeave(toast)
    expect(view.emitted().release).toEqual([[7]])
  })

  it('keeps holding when keyboard focus is inside as the pointer leaves', async () => {
    const view = renderRegion(true)
    const toast = screen.getByRole('status', { name: 'Tab closed' })
    screen.getByRole('button', { name: 'Undo: Tab closed' }).focus()

    await fireEvent.pointerEnter(toast)
    await fireEvent.pointerLeave(toast)

    expect(view.emitted().retain?.length).toBeGreaterThan(0)
    expect(view.emitted().release).toBeUndefined()
  })

  it('does not hold or release a toast without an action on pointer movement', async () => {
    const view = renderRegion(false)
    const toast = screen.getByRole('status', { name: 'Tab closed' })

    expect(toast).not.toHaveClass('with-action')
    expect(screen.queryByTestId('app-toast-action')).toBeNull()
    await fireEvent.pointerEnter(toast)
    await fireEvent.pointerLeave(toast)

    expect(view.emitted().retain).toBeUndefined()
    expect(view.emitted().release).toBeUndefined()
  })
})

function offer(overrides: Partial<UndoOffer> = {}): UndoOffer {
  return { token: TOKEN_A, kind: 'tabs-closed', name: 'Example page', count: 1, ...overrides }
}

function setupUndo(options: { mac?: boolean } = {}) {
  let offered: ((offer: unknown) => void) | undefined
  let ended: ((token: unknown) => void) | undefined
  const stopOffered = vi.fn()
  const stopEnded = vi.fn()
  const browser = {
    onUndoOffered: vi.fn((listener: (offer: UndoOffer) => void) => {
      offered = listener as (offer: unknown) => void
      return stopOffered
    }),
    onUndoEnded: vi.fn((listener: (token: string) => void) => {
      ended = listener as (token: unknown) => void
      return stopEnded
    }),
    undo: vi.fn(async (_token: string) => true),
    holdUndo: vi.fn(async (_token: string) => undefined),
    finishUndo: vi.fn(async (_token: string) => undefined)
  }
  const toasts = useAppToastController()
  const undo = useUndoToasts({ browser, toasts, translate, mac: options.mac ?? false })
  return {
    browser,
    toasts,
    stopOffered,
    stopEnded,
    offer: (value: unknown) => offered!(value),
    end: (token: unknown) => ended!(token),
    dispose: () => {
      undo.dispose()
      toasts.dispose()
    }
  }
}

/** Lets every pending promise continuation run. */
function flushTasks(): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, 0) })
}

function pressZ(init: KeyboardEventInit = {}, target: EventTarget = window): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}

describe('useUndoToasts', () => {
  it.each([
    ['a token that is not a UUID', { ...offer(), token: 'not-a-token' }],
    ['an unknown kind', { ...offer(), kind: 'history-cleared' }],
    ['a count of zero', { ...offer(), count: 0 }],
    ['a fractional count', { ...offer(), count: 1.5 }],
    ['a missing name', { token: TOKEN_A, kind: 'tabs-closed', count: 1 }],
    ['no object at all', null]
  ])('ignores an offer with %s', (_name, value) => {
    const undo = setupUndo()
    undo.offer(value)

    expect(undo.toasts.toasts.value).toEqual([])
    expect(pressZ().defaultPrevented).toBe(false)
    expect(undo.browser.undo).not.toHaveBeenCalled()
    undo.dispose()
  })

  it.each([
    [{ kind: 'tabs-closed' as const, count: 1 }, 'Tab closed'],
    [{ kind: 'tabs-closed' as const, count: 3 }, '3 tabs closed'],
    [{ kind: 'workspace-archived' as const, count: 1 }, 'Workspace archived'],
    [{ kind: 'workspace-closed' as const, count: 1 }, 'Workspace closed'],
    [{ kind: 'bookmark-removed' as const, count: 1 }, 'Bookmark removed']
  ])('shows %o as a toast titled "%s" with an Undo button for six seconds', async (fields, title) => {
    vi.useFakeTimers()
    const undo = setupUndo()
    undo.offer(offer(fields))

    expect(undo.toasts.toasts.value).toEqual([expect.objectContaining({
      tone: 'success',
      title,
      message: 'Example page',
      action: { label: 'Undo', ariaLabel: `Undo: ${title}` }
    })])
    await vi.advanceTimersByTimeAsync(UNDO_OFFER_MS - 1)
    expect(undo.toasts.toasts.value).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(undo.toasts.toasts.value).toEqual([])
    expect(undo.browser.finishUndo).toHaveBeenCalledWith(TOKEN_A)
    undo.dispose()
  })

  it('holds the offer while the person is on the toast and finishes it when the toast is dismissed', () => {
    const undo = setupUndo()
    undo.offer(offer())
    const id = undo.toasts.toasts.value[0].id

    undo.toasts.retain(id)
    expect(undo.browser.holdUndo).toHaveBeenCalledWith(TOKEN_A)
    undo.toasts.dismiss(id)

    expect(undo.browser.finishUndo).toHaveBeenCalledWith(TOKEN_A)
    expect(undo.browser.undo).not.toHaveBeenCalled()
    undo.dispose()
  })

  it('swallows a rejected hold or finish so no rejection is left unhandled', async () => {
    const undo = setupUndo()
    undo.browser.holdUndo.mockRejectedValueOnce(new Error('main went away'))
    undo.browser.finishUndo.mockRejectedValueOnce(new Error('main went away'))
    undo.offer(offer())
    const id = undo.toasts.toasts.value[0].id

    undo.toasts.retain(id)
    undo.toasts.dismiss(id)
    await flushTasks()

    expect(undo.browser.finishUndo).toHaveBeenCalledOnce()
    undo.dispose()
  })

  it('runs Undo from the toast button without finishing the offer first', async () => {
    const undo = setupUndo()
    undo.offer(offer())

    undo.toasts.act(undo.toasts.toasts.value[0].id)

    await vi.waitFor(() => expect(undo.browser.undo).toHaveBeenCalledWith(TOKEN_A))
    expect(undo.browser.finishUndo).not.toHaveBeenCalled()
    expect(undo.toasts.toasts.value).toEqual([])
    undo.dispose()
  })

  it('leaves the offer to main when another message takes the toast, and Ctrl+Z still undoes it', async () => {
    const undo = setupUndo()
    undo.offer(offer())
    undo.toasts.show('info', 'Link copied', 'https://example.test')

    expect(undo.browser.finishUndo).not.toHaveBeenCalled()
    expect(pressZ().defaultPrevented).toBe(true)

    await vi.waitFor(() => expect(undo.browser.undo).toHaveBeenCalledWith(TOKEN_A))
    // The newer message stays: Ctrl+Z went straight to main rather than through a toast that is gone.
    expect(undo.toasts.toasts.value[0]?.title).toBe('Link copied')
    undo.dispose()
  })

  it('drops the toast 80 ms after main ends its offer and stops Ctrl+Z from undoing it', async () => {
    vi.useFakeTimers()
    const undo = setupUndo()
    undo.offer(offer())

    undo.end(TOKEN_A)
    await vi.advanceTimersByTimeAsync(79)
    expect(undo.toasts.toasts.value).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(undo.toasts.toasts.value).toEqual([])

    expect(pressZ().defaultPrevented).toBe(false)
    expect(undo.browser.undo).not.toHaveBeenCalled()
    undo.dispose()
  })

  it('keeps the newer offer\'s toast, and its hold, when main ends the old offer just before offering again', async () => {
    vi.useFakeTimers()
    const undo = setupUndo()
    undo.offer(offer())
    undo.toasts.retain(undo.toasts.toasts.value[0].id)

    undo.end(TOKEN_A)
    undo.offer(offer({ token: TOKEN_B, name: 'Second page' }))
    await vi.advanceTimersByTimeAsync(80)

    expect(undo.toasts.toasts.value).toEqual([expect.objectContaining({ title: 'Tab closed', message: 'Second page' })])
    expect(undo.browser.holdUndo).toHaveBeenLastCalledWith(TOKEN_B)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(undo.toasts.toasts.value).toHaveLength(1)
    undo.dispose()
  })

  it('ignores an end for a token that is not a string or not the shown offer', async () => {
    vi.useFakeTimers()
    const undo = setupUndo()
    undo.offer(offer())

    undo.end(42)
    undo.end(TOKEN_B)
    await vi.advanceTimersByTimeAsync(80)

    expect(undo.toasts.toasts.value).toHaveLength(1)
    undo.dispose()
  })

  it('undoes through the shown toast on Ctrl+Z outside text fields', async () => {
    const undo = setupUndo()
    undo.offer(offer())

    const event = pressZ()

    expect(event.defaultPrevented).toBe(true)
    await vi.waitFor(() => expect(undo.browser.undo).toHaveBeenCalledWith(TOKEN_A))
    expect(undo.browser.finishUndo).not.toHaveBeenCalled()
    expect(undo.toasts.toasts.value).toEqual([])
    // The offer was used: a second press does nothing.
    expect(pressZ().defaultPrevented).toBe(false)
    expect(undo.browser.undo).toHaveBeenCalledOnce()
    undo.dispose()
  })

  it('undoes on Ctrl+Z with a Russian or Ukrainian layout on, where the Z key types я', async () => {
    // The key reads я there, so Ctrl+Z did nothing while the toast offered Undo.
    const undo = setupUndo()
    onTestFinished(undo.dispose)
    undo.offer(offer())

    expect(pressZ({ key: 'я', code: 'KeyZ' }).defaultPrevented).toBe(true)
    await vi.waitFor(() => expect(undo.browser.undo).toHaveBeenCalledWith(TOKEN_A))
  })

  it('leaves Ctrl+Z alone where a Latin layout types another letter on the Z key, as German types y there', () => {
    const undo = setupUndo()
    onTestFinished(undo.dispose)
    undo.offer(offer())

    expect(pressZ({ key: 'y', code: 'KeyZ' }).defaultPrevented).toBe(false)
    expect(undo.browser.undo).not.toHaveBeenCalled()
  })

  it.each([
    ['a text input', () => Object.assign(document.createElement('input'), { type: 'text' })],
    ['a search input', () => Object.assign(document.createElement('input'), { type: 'search' })],
    ['a textarea', () => document.createElement('textarea')],
    ['a select', () => document.createElement('select')],
    ['an editable region', () => {
      const element = document.createElement('div')
      element.contentEditable = 'true'
      // jsdom does not compute isContentEditable from the attribute.
      Object.defineProperty(element, 'isContentEditable', { value: true })
      return element
    }]
  ])('leaves Ctrl+Z to %s for its own text', (_name, create) => {
    const undo = setupUndo()
    const field = create()
    document.body.append(field)
    undo.offer(offer())

    const event = pressZ({}, field)

    expect(event.defaultPrevented).toBe(false)
    expect(undo.browser.undo).not.toHaveBeenCalled()
    expect(undo.toasts.toasts.value).toHaveLength(1)
    field.remove()
    undo.dispose()
  })

  it('undoes on Ctrl+Z from a checkbox, which has no text to undo', async () => {
    const undo = setupUndo()
    const checkbox = Object.assign(document.createElement('input'), { type: 'checkbox' })
    document.body.append(checkbox)
    undo.offer(offer())

    expect(pressZ({}, checkbox).defaultPrevented).toBe(true)

    await vi.waitFor(() => expect(undo.browser.undo).toHaveBeenCalledWith(TOKEN_A))
    checkbox.remove()
    undo.dispose()
  })

  it.each([
    ['Shift', { shiftKey: true }],
    ['Alt', { altKey: true }],
    ['Meta as well as Ctrl', { metaKey: true }],
    ['a repeat', { repeat: true }],
    ['an IME composition', { isComposing: true }],
    ['another key', { key: 'y' }],
    ['no Ctrl', { ctrlKey: false }]
  ])('ignores Ctrl+Z with %s outside macOS', (_name, init) => {
    const undo = setupUndo()
    undo.offer(offer())

    expect(pressZ(init).defaultPrevented).toBe(false)

    expect(undo.browser.undo).not.toHaveBeenCalled()
    undo.dispose()
  })

  it('ignores a key press another handler already took', () => {
    const undo = setupUndo()
    undo.offer(offer())
    const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })
    event.preventDefault()

    window.dispatchEvent(event)

    expect(undo.browser.undo).not.toHaveBeenCalled()
    undo.dispose()
  })

  it('uses Cmd+Z on macOS and leaves Ctrl+Z alone there', async () => {
    const undo = setupUndo({ mac: true })
    undo.offer(offer())

    expect(pressZ().defaultPrevented).toBe(false)
    expect(pressZ({ ctrlKey: true, metaKey: true }).defaultPrevented).toBe(false)
    expect(undo.browser.undo).not.toHaveBeenCalled()
    expect(pressZ({ ctrlKey: false, metaKey: true, key: 'Z' }).defaultPrevented).toBe(true)

    await vi.waitFor(() => expect(undo.browser.undo).toHaveBeenCalledWith(TOKEN_A))
    undo.dispose()
  })

  it('says there is nothing to undo when main brings nothing back', async () => {
    const undo = setupUndo()
    undo.browser.undo.mockResolvedValueOnce(false)
    undo.offer(offer())

    undo.toasts.act(undo.toasts.toasts.value[0].id)

    await vi.waitFor(() => expect(undo.toasts.toasts.value).toEqual([expect.objectContaining({
      tone: 'info',
      title: 'Nothing to undo',
      message: 'That can no longer be undone.'
    })]))
    undo.dispose()
  })

  it('keeps a newer offer\'s toast instead of saying an older Undo did nothing', async () => {
    const undo = setupUndo()
    let finish!: (value: boolean) => void
    undo.browser.undo.mockImplementationOnce(() => new Promise<boolean>((resolve) => { finish = resolve }))
    undo.offer(offer())
    undo.toasts.act(undo.toasts.toasts.value[0].id)
    undo.offer(offer({ token: TOKEN_B, kind: 'bookmark-removed', name: 'Docs' }))

    finish(false)
    await flushTasks()

    expect(undo.browser.undo).toHaveBeenCalledOnce()
    expect(undo.toasts.toasts.value).toEqual([expect.objectContaining({ title: 'Bookmark removed', message: 'Docs' })])
    undo.dispose()
  })

  it('keeps a newer offer\'s toast instead of saying an older Undo failed', async () => {
    const undo = setupUndo()
    onTestFinished(undo.dispose)
    let fail!: (error: Error) => void
    undo.browser.undo.mockImplementationOnce(() => new Promise<boolean>((_resolve, reject) => { fail = reject }))
    undo.offer(offer())
    undo.toasts.act(undo.toasts.toasts.value[0].id)
    undo.offer(offer({ token: TOKEN_B, kind: 'bookmark-removed', name: 'Docs' }))

    fail(new Error('The workspace is busy'))
    await flushTasks()

    expect(undo.toasts.toasts.value).toEqual([expect.objectContaining({ title: 'Bookmark removed', message: 'Docs' })])
    pressZ()
    await vi.waitFor(() => expect(undo.browser.undo).toHaveBeenLastCalledWith(TOKEN_B))
  })

  it('says an older Undo failed when the newer offer\'s toast is no longer on screen', async () => {
    const undo = setupUndo()
    onTestFinished(undo.dispose)
    let fail!: (error: Error) => void
    undo.browser.undo.mockImplementationOnce(() => new Promise<boolean>((_resolve, reject) => { fail = reject }))
    undo.offer(offer())
    undo.toasts.act(undo.toasts.toasts.value[0].id)
    undo.offer(offer({ token: TOKEN_B, kind: 'bookmark-removed', name: 'Docs' }))
    // Another message takes the newer offer's place while main still holds that offer.
    undo.toasts.show('info', 'Link copied', 'https://example.test')

    fail(new Error('The workspace is busy'))
    await flushTasks()

    expect(undo.toasts.toasts.value).toEqual([expect.objectContaining({ tone: 'error', title: 'Could not undo', message: 'The workspace is busy' })])
  })

  it('shows why Undo failed, without the IPC wrapper', async () => {
    const undo = setupUndo()
    undo.browser.undo.mockRejectedValueOnce(new Error("Error invoking remote method 'undo:run': Error: The workspace is busy"))
    undo.offer(offer({ kind: 'workspace-closed', name: 'Research' }))

    pressZ()

    await vi.waitFor(() => expect(undo.toasts.toasts.value).toEqual([expect.objectContaining({
      tone: 'error',
      title: 'Could not undo',
      message: 'The workspace is busy'
    })]))
    undo.dispose()
  })

  it('stops listening and shows nothing late once disposed', async () => {
    const undo = setupUndo()
    let finish!: (value: boolean) => void
    undo.browser.undo.mockImplementationOnce(() => new Promise<boolean>((resolve) => { finish = resolve }))
    undo.offer(offer())
    pressZ()
    await vi.waitFor(() => expect(undo.browser.undo).toHaveBeenCalledOnce())
    undo.offer(offer({ token: TOKEN_B }))

    undo.dispose()
    expect(undo.stopOffered).toHaveBeenCalledOnce()
    expect(undo.stopEnded).toHaveBeenCalledOnce()
    finish(false)
    await flushTasks()

    expect(pressZ().defaultPrevented).toBe(false)
    expect(undo.browser.undo).toHaveBeenCalledOnce()
    expect(undo.toasts.toasts.value).toEqual([])
  })
})

function workspace(id: string, name: string): BrowserTabGroupState {
  return {
    id,
    name,
    description: '',
    color: 'purple',
    createdAt: '2026-10-01T00:00:00.000Z',
    lastUsedAt: '2026-10-01T00:00:00.000Z',
    tabCount: 0,
    activeTabId: null,
    storageOriginCount: 0,
    navigationPolicy: { mode: 'unrestricted', rules: [] }
  }
}

function archived(index: number): BrowserSavedTabGroupState {
  return {
    id: `saved-${index}`,
    name: `Archived ${index}`,
    description: '',
    color: 'blue',
    savedAt: '2026-10-01T00:00:00.000Z',
    storageOriginCount: 0,
    navigationPolicy: { mode: 'unrestricted', rules: [] },
    tabs: []
  }
}

function createEditor(archivedCount: number) {
  const state: Ref<BrowserState> = ref({
    tabs: [],
    closedTabs: [],
    activeTabId: null,
    allHumanInteractionLocked: false,
    mcpUrl: 'http://127.0.0.1:47812/mcp',
    profilePath: '/profile',
    mcpTabGroups: [workspace('default', 'Default'), workspace('agent', 'Agent workspace')],
    savedTabGroups: Array.from({ length: archivedCount }, (_, index) => archived(index))
  })
  const confirm = vi.fn(async () => true)
  const browser = {
    getState: vi.fn(async () => state.value),
    createWorkspace: vi.fn(async () => state.value),
    updateTabGroup: vi.fn(async () => state.value),
    updateWorkspaceNavigationPolicy: vi.fn(async () => state.value),
    listWorkspaceNavigationAudit: vi.fn(async () => []),
    listWorkspaceStorageOrigins: vi.fn(async () => []),
    transferWorkspaceStorage: vi.fn(async () => { throw new Error('not used') }),
    closeWorkspace: vi.fn(async (_id: string, _options?: { undoable?: boolean }) => state.value)
  }
  const controller = useWorkspaceEditorController({
    state,
    open: ref(false),
    browser,
    syncState: async (next) => { state.value = await Promise.resolve(next) },
    translate: (key, parameters) => parameters ? `${key}:${JSON.stringify(parameters)}` : key,
    formatNumber: String,
    confirm,
    canPresent: () => true
  })
  return { controller, confirm, browser }
}

describe('workspace editor close with a full archive', () => {
  it('closes with Undo and no question while the archive has room', async () => {
    const { controller, confirm, browser } = createEditor(MAX_ARCHIVED_WORKSPACES - 1)
    await controller.openExisting('agent')

    await controller.closeWorkspace()

    expect(confirm).not.toHaveBeenCalled()
    expect(browser.closeWorkspace).toHaveBeenCalledWith('agent', { undoable: true })
    controller.dispose()
  })

  it('asks first and closes for good, without Undo, when the archive is full', async () => {
    const { controller, confirm, browser } = createEditor(MAX_ARCHIVED_WORKSPACES)
    await controller.openExisting('agent')

    confirm.mockResolvedValueOnce(false)
    await controller.closeWorkspace()
    expect(confirm).toHaveBeenCalledWith({ message: 'runtimeActions.workspace.closeConfirm:{"name":"Agent workspace"}' })
    expect(browser.closeWorkspace).not.toHaveBeenCalled()

    await controller.closeWorkspace()
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(browser.closeWorkspace).toHaveBeenCalledOnce()
    expect(browser.closeWorkspace.mock.calls[0]).toEqual(['agent'])
    controller.dispose()
  })
})

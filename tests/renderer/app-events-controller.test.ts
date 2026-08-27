import { describe, expect, it, vi } from 'vitest'
import { useAppEventsController } from '../../src/renderer/src/composables/useAppEventsController.js'
import type { BrowserShortcutAction } from '../../src/shared/browser-shortcuts.js'
import type {
  BrowserActionFailure,
  CredentialSummary,
  HelpMenuAction,
  SitePermissionEntry
} from '../../src/shared/types.js'

type EventListeners = {
  attention?: () => void
  shortcut?: (action: BrowserShortcutAction) => void
  tabGroupEdit?: (groupId: string) => void
  permissions?: (permissions: SitePermissionEntry[]) => void
  credentials?: (credentials: CredentialSummary[]) => void
  updateOpen?: () => void
  help?: (action: HelpMenuAction) => void
  clipboardFailure?: (message: string) => void
  actionFailure?: (failure: BrowserActionFailure) => void
}

function createHarness() {
  const listeners: EventListeners = {}
  const unsubscribers = Array.from({ length: 9 }, () => vi.fn())
  const subscribe = <Key extends keyof EventListeners>(key: Key, index: number) => (
    listener: NonNullable<EventListeners[Key]>
  ) => {
    listeners[key] = listener
    return unsubscribers[index]
  }
  const apis = {
    browserApi: {
      onUserAttentionRequested: vi.fn(subscribe('attention', 0)),
      onShortcutRequested: vi.fn(subscribe('shortcut', 1)),
      onTabGroupEditRequested: vi.fn(subscribe('tabGroupEdit', 2))
    },
    permissionsApi: { onChanged: vi.fn(subscribe('permissions', 3)) },
    credentialsApi: { onChanged: vi.fn(subscribe('credentials', 4)) },
    updatesApi: { onOpenRequested: vi.fn(subscribe('updateOpen', 5)) },
    shellApi: {
      onHelpRequested: vi.fn(subscribe('help', 6)),
      onClipboardFailed: vi.fn(subscribe('clipboardFailure', 7)),
      onActionFailed: vi.fn(subscribe('actionFailure', 8))
    }
  }
  const callbacks = {
    onUserAttention: vi.fn(),
    onShortcut: vi.fn(),
    onTabGroupEdit: vi.fn(),
    onPermissionsChanged: vi.fn(),
    onCredentialsChanged: vi.fn(),
    onUpdateOpen: vi.fn(),
    onHelp: vi.fn(),
    onClipboardFailure: vi.fn(),
    onActionFailure: vi.fn(),
    onError: vi.fn()
  }
  const controller = useAppEventsController({ ...apis, ...callbacks })
  return { apis, callbacks, controller, listeners, unsubscribers }
}

describe('app events controller', () => {
  it('subscribes to every native event immediately and forwards its payload', () => {
    const harness = createHarness()
    const permission: SitePermissionEntry = {
      origin: 'https://example.test',
      permission: 'geolocation',
      decision: 'allow'
    }
    const credential: CredentialSummary = {
      id: 'credential-1',
      origin: 'https://example.test',
      username: 'Person',
      createdAt: '2026-08-23T00:00:00.000Z',
      updatedAt: '2026-08-23T00:00:00.000Z'
    }
    const failure: BrowserActionFailure = { action: 'reload', message: 'Renderer unavailable' }

    const subscriptions = Object.values(harness.apis).flatMap((api) => Object.values(api))
    expect(subscriptions.every((subscription) => vi.mocked(subscription).mock.calls.length === 1)).toBe(true)

    harness.listeners.attention?.()
    harness.listeners.shortcut?.('new-tab')
    harness.listeners.tabGroupEdit?.('group-1')
    harness.listeners.permissions?.([permission])
    harness.listeners.credentials?.([credential])
    harness.listeners.updateOpen?.()
    harness.listeners.help?.('shortcuts')
    harness.listeners.clipboardFailure?.('Clipboard unavailable')
    harness.listeners.actionFailure?.(failure)

    expect(harness.callbacks.onUserAttention).toHaveBeenCalledOnce()
    expect(harness.callbacks.onShortcut).toHaveBeenCalledWith('new-tab')
    expect(harness.callbacks.onTabGroupEdit).toHaveBeenCalledWith('group-1')
    expect(harness.callbacks.onPermissionsChanged).toHaveBeenCalledWith([permission])
    expect(harness.callbacks.onCredentialsChanged).toHaveBeenCalledWith([credential])
    expect(harness.callbacks.onUpdateOpen).toHaveBeenCalledOnce()
    expect(harness.callbacks.onHelp).toHaveBeenCalledWith('shortcuts')
    expect(harness.callbacks.onClipboardFailure).toHaveBeenCalledWith('Clipboard unavailable')
    expect(harness.callbacks.onActionFailure).toHaveBeenCalledWith(failure)
    harness.controller.dispose()
  })

  it('unsubscribes once and ignores events delivered after disposal', () => {
    const harness = createHarness()
    harness.controller.dispose()
    harness.controller.dispose()

    harness.listeners.attention?.()
    harness.listeners.shortcut?.('new-tab')
    harness.listeners.updateOpen?.()
    harness.listeners.help?.('about')
    harness.listeners.actionFailure?.({ action: 'reload', message: 'Late failure' })

    expect(harness.unsubscribers.every((unsubscribe) => unsubscribe.mock.calls.length === 1)).toBe(true)
    expect(Object.values(harness.callbacks).every((callback) => callback.mock.calls.length === 0)).toBe(true)
  })

  it('contains rejected native-event work and reports it through the shell boundary', async () => {
    const harness = createHarness()
    const failure = new Error('workspace state unavailable')
    harness.callbacks.onTabGroupEdit.mockRejectedValueOnce(failure)

    harness.listeners.tabGroupEdit?.('group-1')
    await vi.waitFor(() => expect(harness.callbacks.onError).toHaveBeenCalledWith(failure))

    harness.controller.dispose()
  })

  it('contains synchronous native-event callback failures through the same boundary', () => {
    const harness = createHarness()
    const failure = new Error('help action unavailable')
    harness.callbacks.onHelp.mockImplementationOnce(() => { throw failure })

    expect(() => harness.listeners.help?.('shortcuts')).not.toThrow()
    expect(harness.callbacks.onError).toHaveBeenCalledWith(failure)

    harness.controller.dispose()
  })

  it('contains a delayed event failure without reporting into a disposed shell', async () => {
    const harness = createHarness()
    let reject!: (error: unknown) => void
    harness.callbacks.onTabGroupEdit.mockReturnValueOnce(new Promise<void>((_resolve, fail) => {
      reject = fail
    }))

    harness.listeners.tabGroupEdit?.('group-1')
    harness.controller.dispose()
    reject(new Error('late workspace failure'))
    await Promise.resolve()

    expect(harness.callbacks.onError).not.toHaveBeenCalled()
  })

  it('unsubscribes every native event when one unsubscriber throws', () => {
    const harness = createHarness()
    const failure = new Error('native event bridge unavailable')
    harness.unsubscribers[0].mockImplementationOnce(() => { throw failure })

    expect(harness.controller.dispose).toThrow(failure)
    expect(harness.unsubscribers.every((unsubscribe) => unsubscribe.mock.calls.length === 1)).toBe(true)

    harness.listeners.help?.('about')
    expect(harness.callbacks.onHelp).not.toHaveBeenCalled()
  })
})

import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { registerTabsIpc } from '../src/main/tabs-ipc.js'
import type { BrowserState } from '../src/shared/types.js'

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

function dropLinkIpc(options: { trusted?: boolean } = {}) {
  const handlers = new Map<string, Handler>()
  const state = { tabs: [] } as unknown as BrowserState
  const tabs = { openDroppedLink: vi.fn(async () => state), beforeStateReply: () => undefined }
  registerTabsIpc({
    assertTrustedSender: () => { if (options.trusted === false) throw new Error('Untrusted sender') },
    assertMainShellSender: () => undefined,
    handleBrowserIpc: (channel: string, listener: unknown) => { handlers.set(channel, listener as Handler) },
    runWorkspaceRead: async <T>(_event: IpcMainInvokeEvent, _assert: unknown, read: () => T) => read(),
    tabs: () => tabs as never,
    mcpServer: () => null,
    takeOvers: () => ({ paused: () => false }) as never
  } as never)
  return {
    state,
    tabs,
    invoke: async (...args: unknown[]) => handlers.get('browser:drop-link')!({} as IpcMainInvokeEvent, ...args)
  }
}

describe('the shell dropping a link on the tab strip', () => {
  it('opens the text on a tab, beside one, or in a workspace\'s new tab', async () => {
    const ipc = dropLinkIpc()

    for (const target of [
      { tabId: 'tab-1', placement: 'onto' }, { tabId: 'tab-1', placement: 'before' }, { tabId: 'tab-1', placement: 'after' },
      { workspaceId: 'workspace-1' }, {}
    ]) {
      await expect(ipc.invoke('https://example.com/', target)).resolves.toBe(ipc.state)
      expect(ipc.tabs.openDroppedLink).toHaveBeenLastCalledWith('https://example.com/', target)
    }
  })

  it('takes only the target fields it knows, so nothing else reaches the tab manager', async () => {
    const ipc = dropLinkIpc()

    await ipc.invoke('https://example.com/', { tabId: 'tab-1', placement: 'onto', extra: 'ignored' })

    expect(ipc.tabs.openDroppedLink).toHaveBeenCalledExactlyOnceWith('https://example.com/', { tabId: 'tab-1', placement: 'onto' })
  })

  it.each([
    ['text that is no string', 42, { tabId: 'tab-1', placement: 'onto' }],
    ['no target', 'https://example.com/', undefined],
    ['a list for a target', 'https://example.com/', ['tab-1']],
    ['a tab without a placement', 'https://example.com/', { tabId: 'tab-1' }],
    ['an unknown placement', 'https://example.com/', { tabId: 'tab-1', placement: 'replace' }],
    ['a tab id that is no string', 'https://example.com/', { tabId: 7, placement: 'onto' }],
    ['a tab and a workspace', 'https://example.com/', { tabId: 'tab-1', placement: 'onto', workspaceId: 'workspace-1' }],
    ['a placement without a tab', 'https://example.com/', { placement: 'after' }],
    ['a workspace id that is no string', 'https://example.com/', { workspaceId: 1 }]
  ])('refuses %s', async (_name, text, target) => {
    const ipc = dropLinkIpc()

    await expect(ipc.invoke(text, target)).rejects.toThrow(TypeError)

    expect(ipc.tabs.openDroppedLink).not.toHaveBeenCalled()
  })

  it('refuses a sender other than the shell', async () => {
    const ipc = dropLinkIpc({ trusted: false })

    await expect(ipc.invoke('https://example.com/', { tabId: 'tab-1', placement: 'onto' })).rejects.toThrow('Untrusted sender')

    expect(ipc.tabs.openDroppedLink).not.toHaveBeenCalled()
  })
})

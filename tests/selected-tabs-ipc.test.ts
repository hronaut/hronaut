import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { registerTabsIpc } from '../src/main/tabs-ipc.js'
import type { BrowserState } from '../src/shared/types.js'

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

// The shell names the tabs selected in its strip when it moves them or opens the menu of one of them.

function selectedTabsIpc(options: { trusted?: boolean } = {}) {
  const handlers = new Map<string, Handler>()
  const state = { tabs: [] } as unknown as BrowserState
  const tabs = { reorderTabs: vi.fn(() => state), showTabContextMenu: vi.fn(), closeTabsForPerson: vi.fn(async () => state), beforeStateReply: () => undefined }
  registerTabsIpc({
    assertTrustedSender: () => { if (options.trusted === false) throw new Error('Untrusted sender') },
    assertMainShellSender: () => undefined,
    handleBrowserIpc: (channel: string, listener: unknown) => { handlers.set(channel, listener as Handler) },
    runWorkspaceRead: async <T>(_event: IpcMainInvokeEvent, _assert: unknown, read: () => T) => read(),
    tabs: () => tabs as never,
    mcpServer: () => null,
    takeOvers: () => ({ paused: () => false }) as never
  } as never)
  const invoke = async (channel: string, ...args: unknown[]) => handlers.get(channel)!({} as IpcMainInvokeEvent, ...args)
  return { state, tabs, invoke }
}

describe('the shell moving its selected tabs', () => {
  it('moves the named tabs before or after the target', async () => {
    const ipc = selectedTabsIpc()
    await expect(ipc.invoke('browser:reorder-tabs', ['a', 'b'], 'c', 'after')).resolves.toBe(ipc.state)
    expect(ipc.tabs.reorderTabs).toHaveBeenCalledExactlyOnceWith(['a', 'b'], 'c', 'after')
  })

  it.each([
    ['no list', 'a', 'c', 'after'],
    ['an empty list', [], 'c', 'after'],
    ['a tab id that is no string', ['a', 2], 'c', 'after'],
    ['more tabs than any strip holds', Array.from({ length: 10_001 }, (_, index) => `tab-${index}`), 'c', 'after'],
    ['a target that is no string', ['a', 'b'], 3, 'after'],
    ['an unknown placement', ['a', 'b'], 'c', 'onto']
  ])('refuses %s', async (_name, tabIds, targetTabId, placement) => {
    const ipc = selectedTabsIpc()
    await expect(ipc.invoke('browser:reorder-tabs', tabIds, targetTabId, placement)).rejects.toThrow(TypeError)
    expect(ipc.tabs.reorderTabs).not.toHaveBeenCalled()
  })

  it('refuses a sender other than the shell', async () => {
    const ipc = selectedTabsIpc({ trusted: false })
    await expect(ipc.invoke('browser:reorder-tabs', ['a', 'b'], 'c', 'after')).rejects.toThrow('Untrusted sender')
    expect(ipc.tabs.reorderTabs).not.toHaveBeenCalled()
  })
})

describe('the shell closing its selected tabs', () => {
  it('closes the named tabs as the person does', async () => {
    const ipc = selectedTabsIpc()
    await ipc.invoke('browser:close-tabs', ['a', 'b'])
    expect(ipc.tabs.closeTabsForPerson).toHaveBeenCalledExactlyOnceWith(['a', 'b'])
  })

  it.each([
    ['no list', 'a'],
    ['an empty list', []],
    ['a tab id that is no string', ['a', 2]],
    ['more tabs than any strip holds', Array.from({ length: 10_001 }, (_, index) => `tab-${index}`)]
  ])('refuses %s', async (_name, tabIds) => {
    const ipc = selectedTabsIpc()
    await expect(ipc.invoke('browser:close-tabs', tabIds)).rejects.toThrow(TypeError)
    expect(ipc.tabs.closeTabsForPerson).not.toHaveBeenCalled()
  })

  it('refuses a sender other than the shell', async () => {
    const ipc = selectedTabsIpc({ trusted: false })
    await expect(ipc.invoke('browser:close-tabs', ['a', 'b'])).rejects.toThrow('Untrusted sender')
    expect(ipc.tabs.closeTabsForPerson).not.toHaveBeenCalled()
  })
})

describe('the shell opening the menu of a selected tab', () => {
  it('passes the selected tabs on with the tab, or none', async () => {
    const ipc = selectedTabsIpc()
    await ipc.invoke('browser:show-tab-context-menu', 'a', ['a', 'b'])
    expect(ipc.tabs.showTabContextMenu).toHaveBeenLastCalledWith('a', undefined, ['a', 'b'])
    await ipc.invoke('browser:show-tab-context-menu', 'a')
    expect(ipc.tabs.showTabContextMenu).toHaveBeenLastCalledWith('a', undefined, undefined)
  })

  it.each([
    ['a list that is no list', 'a'],
    ['an empty list', []],
    ['a tab id that is no string', ['a', null]]
  ])('refuses %s', async (_name, selected) => {
    const ipc = selectedTabsIpc()
    await expect(ipc.invoke('browser:show-tab-context-menu', 'a', selected)).rejects.toThrow(TypeError)
    expect(ipc.tabs.showTabContextMenu).not.toHaveBeenCalled()
  })
})

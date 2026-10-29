import type { IpcMainInvokeEvent } from 'electron'
import { expect, it } from 'vitest'
import { registerNavigationIpc } from '../src/main/navigation-ipc.js'
import { registerTabsIpc } from '../src/main/tabs-ipc.js'
import type { BrowserState } from '../src/shared/types.js'

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

/** The tabs and navigation IPC with a tab runtime that records when an action ends and when a waiting change is sent. */
function shellActions() {
  const handlers = new Map<string, Handler>()
  const order: string[] = []
  const state = { tabs: [] } as unknown as BrowserState
  const action = async (): Promise<BrowserState> => { order.push('action ended'); return state }
  const tabs = {
    getState: () => { order.push('action ended'); return state },
    openHome: action, newTab: action, selectTabForPerson: action, closeTabsForPerson: action,
    navigate: action, back: action, forward: action, reload: action,
    beforeStateReply: () => { order.push('waiting change sent') }
  }
  const host = {
    assertTrustedSender: () => undefined,
    assertMainShellSender: () => undefined,
    handleBrowserIpc: (channel: string, listener: unknown) => { handlers.set(channel, listener as Handler) },
    runWorkspaceRead: async <T>(_event: IpcMainInvokeEvent, _assert: unknown, read: () => T) => read(),
    tabs: () => tabs as never,
    mcpServer: () => null,
    takeOvers: () => ({ paused: () => false }) as never,
    defaultPdfPageSize: () => 'A4' as const
  }
  registerTabsIpc(host as never)
  registerNavigationIpc(host as never)
  return {
    state,
    order,
    async invoke(channel: string, ...args: unknown[]): Promise<unknown> {
      const reply = Promise.resolve(handlers.get(channel)!({} as IpcMainInvokeEvent, ...args))
      void reply.then(() => order.push('replied'))
      return reply
    }
  }
}

it('sends a change waiting for the shell to draw before replying to each shell action with the browser state', async () => {
  // The shell drops a reply when a state arrives meanwhile; a waiting change sent first keeps it from ending on an
  // older state than the reply.
  for (const [channel, ...args] of [
    ['browser:get-state'], ['browser:open-home'], ['browser:new-tab', {}], ['browser:select-tab', 'tab'], ['browser:close-tab', 'tab'],
    ['browser:navigate', { url: 'https://example.com/' }], ['browser:back'], ['browser:forward'], ['browser:reload']
  ] as const) {
    const shell = shellActions()
    await expect(shell.invoke(channel, ...args), channel).resolves.toBe(shell.state)
    await Promise.resolve()
    expect(shell.order, channel).toEqual(['action ended', 'waiting change sent', 'replied'])
  }
})

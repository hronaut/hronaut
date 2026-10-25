import type { IpcMainInvokeEvent } from 'electron'
import { expect, it, vi } from 'vitest'
import { registerPanelWindowIpc } from '../src/main/panel-window-ipc.js'

function register() {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
  const steps: string[] = []
  const mainShell = {} as IpcMainInvokeEvent
  const host = {
    assertMainShellSender: vi.fn((event: IpcMainInvokeEvent) => {
      if (event !== mainShell) throw new Error('Untrusted sender')
    }),
    assertTrustedSender: vi.fn(),
    assertPanelShellSender: vi.fn(),
    openPanelWindow: vi.fn(async (panel: string) => {
      await Promise.resolve()
      steps.push(`open ${panel}`)
    }),
    closePanelWindow: vi.fn(),
    panelWindowRefs: { window: null, panel: null, redocking: false },
    detachedPanelTitle: (panel: string) => panel,
    mainWindow: () => null,
    sendToPanelWindow: vi.fn((channel: string, ...args: unknown[]) => { steps.push(`send ${channel} ${JSON.stringify(args)}`) })
  }
  registerPanelWindowIpc({ handle: (channel, handler) => { handlers.set(channel, handler) } }, host)
  const invoke = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise.resolve().then(() => handlers.get('panel-window:bookmark-all-tabs')!(event, ...args))
  return { host, steps, mainShell, invoke }
}

it('asks for Bookmark all tabs\' name in the panel window once it shows Bookmarks, for the main window only', async () => {
  const { host, steps, mainShell, invoke } = register()
  await invoke(mainShell, 'client')
  await invoke(mainShell, null)
  expect(steps).toEqual([
    'open bookmarks', 'send browser:bookmark-all-tabs-requested ["client"]',
    'open bookmarks', 'send browser:bookmark-all-tabs-requested [null]'
  ])
  // The panel window itself, or a page, cannot ask; nor can a workspace be anything but an id or none.
  await expect(invoke({} as IpcMainInvokeEvent, 'client')).rejects.toThrow('Untrusted sender')
  for (const workspaceId of [undefined, 1, { id: 'client' }, ['client']]) {
    await expect(invoke(mainShell, workspaceId)).rejects.toThrow('Invalid workspace')
  }
  expect(host.openPanelWindow).toHaveBeenCalledTimes(2)
  expect(host.sendToPanelWindow).toHaveBeenCalledTimes(2)
})

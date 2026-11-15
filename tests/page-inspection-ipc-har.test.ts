import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { registerPageInspectionIpc } from '../src/main/page-inspection-ipc.js'

// The fake browser below stubs the functions the code under test calls; these reach its stubs.
vi.mock('../src/main/browser/network-inspection/network-inspection.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/network-inspection/network-inspection.js')>(),
  saveNetworkHar: (browser: { saveNetworkHar: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.saveNetworkHar(...args)
}))

// A HAR file the person saves from Network asks where to save it when the download folder cannot be written to, over
// the window of the page that asked, which can be Network moved to its own window; an agent's never asks.
vi.mock('../src/main/browser/person-export/person-export-file.js', () => ({
  personExportFile: (browser: unknown, asking: unknown) => ({ askingOver: browser, from: asking })
}))

describe('saving a HAR file from Network', () => {
  it('saves it as an export the person asked for, from the page that asked', async () => {
    const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
    const saveNetworkHar = vi.fn(async () => ({ filename: 'network.har', path: '/downloads/network.har', bytes: 1, requests: 0 }))
    const browser = { saveNetworkHar }
    registerPageInspectionIpc({
      assertTrustedSender: () => undefined,
      handleBrowserIpc: (channel, listener) => { handlers.set(channel, listener as never) },
      tabs: () => browser as never,
      copyTextToClipboard: async () => undefined,
      copyPngToClipboard: async () => ({ width: 0, height: 0 })
    })
    const sender = { id: 7 }
    await handlers.get('browser:save-network-har')!({ sender } as never, { tabId: 'tab' })
    expect(saveNetworkHar).toHaveBeenCalledExactlyOnceWith({ tabId: 'tab' }, { askingOver: browser, from: sender })
  })
})

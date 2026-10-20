import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { registerNavigationIpc } from '../src/main/navigation-ipc.js'

function savePdfHandler(paper: 'A4' | 'Letter') {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
  const savePdf = vi.fn(async () => ({ filename: 'page.pdf', path: '/downloads/page.pdf', bytes: 1 }))
  registerNavigationIpc({
    assertTrustedSender: () => undefined,
    handleBrowserIpc: (channel, listener) => { handlers.set(channel, listener as never) },
    tabs: () => ({ savePdf }) as never,
    defaultPdfPageSize: () => paper
  })
  const handler = handlers.get('browser:save-pdf')!
  return { save: (options: unknown) => handler({} as IpcMainInvokeEvent, options), savePdf }
}

describe('saving a PDF from Hronaut controls', () => {
  it('uses the paper of the person\'s region when the control names none', async () => {
    // The PDF button always saved Letter.
    const { save, savePdf } = savePdfHandler('A4')
    await save({ tabId: 'tab' })
    expect(savePdf).toHaveBeenCalledWith(expect.objectContaining({ tabId: 'tab', pageSize: 'A4' }))
  })

  it('keeps a paper the control names', async () => {
    const { save, savePdf } = savePdfHandler('A4')
    await save({ tabId: 'tab', pageSize: 'Legal' })
    expect(savePdf).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 'Legal' }))
  })
})

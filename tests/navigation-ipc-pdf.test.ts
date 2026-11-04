import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { registerNavigationIpc } from '../src/main/navigation-ipc.js'

// The fake browser below stubs the functions the code under test calls; these reach its stubs.
vi.mock('../src/main/browser/pdf-export/pdf-export.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/pdf-export/pdf-export.js')>(),
  savePdf: (browser: { savePdf: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.savePdf(...args)
}))

// The person's own PDF asks where to save it when the download folder cannot be written to; an agent's never does.
vi.mock('../src/main/browser/person-export/person-export-file.js', () => ({ personExportFile: (browser: unknown) => ({ askingOver: browser }) }))

function savePdfHandler(paper: 'A4' | 'Letter') {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
  const savePdf = vi.fn(async (..._args: unknown[]) => ({ filename: 'page.pdf', path: '/downloads/page.pdf', bytes: 1 }))
  const browser = { savePdf }
  registerNavigationIpc({
    assertTrustedSender: () => undefined,
    handleBrowserIpc: (channel, listener) => { handlers.set(channel, listener as never) },
    tabs: () => browser as never,
    defaultPdfPageSize: () => paper
  })
  const handler = handlers.get('browser:save-pdf')!
  return { save: (options: unknown) => handler({} as IpcMainInvokeEvent, options), savePdf, browser }
}

describe('saving a PDF from Hronaut controls', () => {
  it('uses the paper of the person\'s region when the control names none', async () => {
    // The PDF button always saved Letter.
    const { save, savePdf, browser } = savePdfHandler('A4')
    await save({ tabId: 'tab' })
    expect(savePdf).toHaveBeenCalledWith(expect.objectContaining({ tabId: 'tab', pageSize: 'A4' }), undefined, undefined, { askingOver: browser })
  })

  it('keeps a paper the control names', async () => {
    const { save, savePdf } = savePdfHandler('A4')
    await save({ tabId: 'tab', pageSize: 'Legal' })
    expect(savePdf.mock.calls[0]?.[0]).toMatchObject({ pageSize: 'Legal' })
  })
})

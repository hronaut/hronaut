import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ContextMenuParams, MenuItemConstructorOptions, WebContents } from 'electron'

const built = vi.hoisted(() => ({ templates: [] as MenuItemConstructorOptions[][] }))

vi.mock('electron', () => ({
  Menu: {
    buildFromTemplate: (template: MenuItemConstructorOptions[]) => {
      built.templates.push(template)
      return { popup: () => undefined }
    }
  }
}))

const { showContextMenu } = await import('../src/main/browser/context-menus/page-context-menu.js')
type PageTab = { id: string, url: string, webContents: WebContents }
type MenuBrowser = Parameters<typeof showContextMenu>[0]

const PAGE = 'https://gallery.example/album/7?sort=new'

const expectSavedLinkName = vi.fn()

function saveFromMenu(itemId: 'save-link' | 'save-image', params: Partial<ContextMenuParams>): ReturnType<typeof vi.fn> {
  const downloadURL = vi.fn()
  const webContents = {
    id: 7,
    isDestroyed: () => false,
    navigationHistory: { canGoBack: () => false, canGoForward: () => false },
    downloadURL
  } as unknown as WebContents
  const tab: PageTab = { id: 'tab', url: PAGE, webContents }
  const browser = {
    tabs: new Map([[tab.id, tab]]),
    window: {},
    options: { copyText: async () => undefined, copyImageAt: async () => undefined },
    text: (key: string) => key,
    isHumanInteractionLocked: () => false,
    downloadController: { expectSavedLinkName }
  } as unknown as MenuBrowser
  showContextMenu(browser, tab as never, {
    x: 10, y: 20, linkURL: '', srcURL: '', selectionText: '', isEditable: false, mediaType: 'none', editFlags: {},
    pageURL: PAGE, frameURL: PAGE, referrerPolicy: 'strict-origin-when-cross-origin', ...params
  } as unknown as ContextMenuParams)
  const item = built.templates.at(-1)!.find(entry => entry.id === itemId)!
  ;(item.click as () => void)()
  return downloadURL
}

afterEach(() => {
  built.templates.length = 0
  expectSavedLinkName.mockReset()
})

describe('saving from the page menu', () => {
  it('sends the page\'s origin as the referrer with Save Image and Save Link', () => {
    // Both sent no referrer, so a host that serves its images only to its own pages refused the save.
    const image = saveFromMenu('save-image', { mediaType: 'image', srcURL: 'https://images.example/a.png', hasImageContents: true })
    expect(image).toHaveBeenCalledWith('https://images.example/a.png', { headers: { Referer: 'https://gallery.example/' } })
    const link = saveFromMenu('save-link', { linkURL: 'https://gallery.example/files/a.zip' })
    expect(link).toHaveBeenCalledWith('https://gallery.example/files/a.zip', { headers: { Referer: 'https://gallery.example/' } })
  })

  it('reads the policy when Electron reports it as a referrer object', () => {
    const link = saveFromMenu('save-link', {
      linkURL: 'https://files.example/a.zip',
      referrerPolicy: { url: PAGE, policy: 'unsafe-url' } as ContextMenuParams['referrerPolicy']
    })
    expect(link).toHaveBeenCalledWith('https://files.example/a.zip', { headers: { Referer: PAGE } })
  })

  it('sends no referrer from a sandboxed frame or under no-referrer', () => {
    const sandboxed = saveFromMenu('save-link', {
      linkURL: 'https://files.example/a.zip',
      frame: { origin: 'null' } as unknown as ContextMenuParams['frame']
    })
    expect(sandboxed).toHaveBeenCalledWith('https://files.example/a.zip')
    const refused = saveFromMenu('save-link', { linkURL: 'https://files.example/a.zip', referrerPolicy: 'no-referrer' as unknown as ContextMenuParams['referrerPolicy'] })
    expect(refused).toHaveBeenCalledWith('https://files.example/a.zip')
  })

  it('gives Save Link the link\'s download name before starting the download, and Save Image none', () => {
    // downloadURL cannot carry the name, so Save Link saved `/export?id=5` as export.csv instead of report.csv.
    const link = saveFromMenu('save-link', { linkURL: 'https://gallery.example/export?id=5', suggestedFilename: 'report.csv' })
    expect(expectSavedLinkName).toHaveBeenCalledExactlyOnceWith(7, 'https://gallery.example/export?id=5', 'report.csv')
    expect(expectSavedLinkName.mock.invocationCallOrder[0]).toBeLessThan(link.mock.invocationCallOrder[0]!)
    expectSavedLinkName.mockReset()
    saveFromMenu('save-link', { linkURL: 'https://gallery.example/files/a.zip', suggestedFilename: '' })
    saveFromMenu('save-image', { mediaType: 'image', srcURL: 'https://images.example/a.png', hasImageContents: true, linkURL: 'https://gallery.example/export?id=5', suggestedFilename: 'report.csv' })
    expect(expectSavedLinkName).not.toHaveBeenCalled()
  })

  it('takes the referrer from the frame that was right-clicked, not the top-level page', () => {
    const link = saveFromMenu('save-link', { linkURL: 'https://files.example/a.zip', frameURL: '' })
    expect(link).toHaveBeenCalledWith('https://files.example/a.zip')
  })
})

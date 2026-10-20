import { Menu, type ContextMenuParams, type MenuItemConstructorOptions } from 'electron'
import { isHronautHomeUrl, isWebUrl } from '../url.js'
import type { PageContextMenuAccess, PageContextMenuTab } from './page-context-menu-access.js'

/**
 * Shows the native context menu for a right-click in the page: link, image,
 * editing and selection actions for what was clicked, then page navigation,
 * copy address and inspect. Each action checks that its tab is still open.
 */
export function showContextMenu<Tab extends PageContextMenuTab>(access: PageContextMenuAccess<Tab>, tab: Tab, params: ContextMenuParams): void {
  const webContents = tab.webContents
  if (webContents.isDestroyed()) return
  const groups: MenuItemConstructorOptions[][] = []
  const reportActionFailure = (action: string, error: unknown): void => {
    console.error(`[browser] Could not ${action} from page context menu:`, error)
    access.options().onActionFailed?.(action, error)
  }
  const withLiveContents = (actionName: string, action: () => void): (() => void) => () => {
    if (webContents.isDestroyed() || access.findTab(tab.id) !== tab) {
      reportActionFailure(actionName, new Error('The tab is no longer available.'))
      return
    }
    try {
      action()
    } catch (error) {
      reportActionFailure(actionName, error)
    }
  }
  const openBackgroundTab = (url: string): void => {
    void access.createTab({ url, active: false, mcpGroupId: tab.mcpGroupId })
      .catch((error) => {
        console.error(`[browser] Could not open context-menu URL ${url}:`, error)
        access.options().onActionFailed?.('open link in new tab', error)
      })
  }
  const reportCopyFailure = (kind: 'text' | 'image', error: unknown): void => {
    console.error(`[browser] Could not copy context-menu ${kind}:`, error)
    access.options().onClipboardCopyFailed?.(error)
  }
  const copyText = (text: string): void => {
    void access.options().copyText(text).catch((error) => reportCopyFailure('text', error))
  }
  const copyImage = (): void => {
    void access.options().copyImageAt(webContents, params.x, params.y)
      .catch((error) => reportCopyFailure('image', error))
  }

  if (params.linkURL) {
    const webLink = isWebUrl(params.linkURL)
    groups.push([
      {
        id: 'open-link-new-tab',
        label: access.text('native.context.openLink'),
        enabled: webLink,
        click: () => openBackgroundTab(params.linkURL)
      },
      {
        id: 'copy-link-address',
        label: access.text('native.context.copyLink'),
        click: () => copyText(params.linkURL)
      },
      {
        id: 'save-link',
        label: access.text('native.context.saveLink'),
        enabled: webLink,
        click: withLiveContents('save link', () => webContents.downloadURL(params.linkURL))
      }
    ])
  }

  if (params.mediaType === 'image' && params.srcURL) {
    groups.push([
      {
        id: 'open-image-new-tab',
        label: access.text('native.context.openImage'),
        enabled: isWebUrl(params.srcURL),
        click: () => openBackgroundTab(params.srcURL)
      },
      {
        id: 'copy-image',
        label: access.text('native.context.copyImage'),
        enabled: params.hasImageContents,
        click: copyImage
      },
      {
        id: 'copy-image-address',
        label: access.text('native.context.copyImageAddress'),
        click: () => copyText(params.srcURL)
      },
      {
        id: 'save-image',
        label: access.text('native.context.saveImage'),
        enabled: isWebUrl(params.srcURL),
        click: withLiveContents('save image', () => webContents.downloadURL(params.srcURL))
      }
    ])
  }

  if (params.isEditable) {
    if (params.misspelledWord) {
      const spellingItems: MenuItemConstructorOptions[] = params.dictionarySuggestions.slice(0, 5).map((suggestion, index) => ({
        id: `spelling-suggestion-${index}`,
        label: suggestion,
        click: withLiveContents('replace misspelling', () => webContents.replaceMisspelling(suggestion))
      }))
      spellingItems.push({
        id: 'add-to-dictionary',
        label: access.text('native.context.addDictionary', { word: params.misspelledWord }),
        click: withLiveContents('add word to dictionary', () => { webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord) })
      })
      groups.push(spellingItems)
    }
    groups.push([
      { id: 'undo', label: access.text('native.context.undo'), enabled: params.editFlags.canUndo, click: withLiveContents('undo', () => webContents.undo()) },
      { id: 'redo', label: access.text('native.context.redo'), enabled: params.editFlags.canRedo, click: withLiveContents('redo', () => webContents.redo()) },
      { type: 'separator' },
      { id: 'cut', label: access.text('native.context.cut'), enabled: params.editFlags.canCut, click: withLiveContents('cut', () => webContents.cut()) },
      { id: 'copy', label: access.text('native.context.copy'), enabled: params.editFlags.canCopy, click: withLiveContents('copy', () => webContents.copy()) },
      { id: 'paste', label: access.text('native.context.paste'), enabled: params.editFlags.canPaste, click: withLiveContents('paste', () => webContents.paste()) },
      { id: 'paste-and-match-style', label: access.text('native.context.pasteMatchStyle'), enabled: params.editFlags.canPaste, click: withLiveContents('paste and match style', () => webContents.pasteAndMatchStyle()) },
      { id: 'delete', label: access.text('native.context.delete'), enabled: params.editFlags.canDelete, click: withLiveContents('delete', () => webContents.delete()) },
      { type: 'separator' },
      { id: 'select-all', label: access.text('native.context.selectAll'), enabled: params.editFlags.canSelectAll, click: withLiveContents('select all', () => webContents.selectAll()) }
    ])
  } else if (params.selectionText) {
    groups.push([{ id: 'copy-selection', label: access.text('native.context.copy'), click: withLiveContents('copy selection', () => webContents.copy()) }])
  }

  const navigation = webContents.navigationHistory
  groups.push([
    {
      id: 'back',
      label: access.text('native.context.back'),
      enabled: navigation.canGoBack(),
      click: () => {
        void access.back(tab.id).catch((error) => access.options().onActionFailed?.('go back', error))
      }
    },
    {
      id: 'forward',
      label: access.text('native.context.forward'),
      enabled: navigation.canGoForward(),
      click: () => {
        void access.forward(tab.id).catch((error) => access.options().onActionFailed?.('go forward', error))
      }
    },
    {
      id: 'reload',
      label: access.text('native.context.reload'),
      click: () => {
        void access.reload(tab.id).catch((error) => access.options().onActionFailed?.('reload', error))
      }
    },
    {
      id: 'reload-ignoring-cache',
      label: access.text('native.context.reloadWithoutCache'),
      click: () => {
        void access.reloadIgnoringCache(tab.id)
          .catch((error) => access.options().onActionFailed?.('reload without cache', error))
      }
    },
    {
      id: 'copy-page-address',
      label: access.text('native.context.copyPageAddress'),
      click: () => copyText(tab.url)
    },
    // Hronaut Home has no Developer Tools, as F12 and Ctrl+Shift+I already refuse there: its page holds Hronaut's
    // privileged Home bridge.
    ...isHronautHomeUrl(tab.url) ? [] : [{
      id: 'inspect-element',
      label: access.text('native.context.inspect'),
      click: () => {
        void inspectElement(access, tab, params.x, params.y)
          .catch((error) => {
            console.error('[browser] Could not inspect the selected element:', error)
            access.options().onActionFailed?.('inspect element', error)
          })
      }
    }]
  ])

  const template = groups.flatMap((group, index) => index === 0
    ? group
    : [{ type: 'separator' as const }, ...group])
  const menu = Menu.buildFromTemplate(template)
  menu.popup({
    window: access.window(),
    ...(params.frame ? { frame: params.frame } : {})
  })
}

async function inspectElement<Tab extends PageContextMenuTab>(access: PageContextMenuAccess<Tab>, tab: Tab, x: number, y: number): Promise<void> {
  if (access.isHumanInteractionLocked(tab) || isHronautHomeUrl(tab.url)) return
  await access.openDevTools(tab)
  const webContents = tab.webContents
  // Inspecting opens Developer Tools by itself, so check again for a tab that shows Home by now.
  if (!webContents.isDestroyed() && !isHronautHomeUrl(tab.url)) webContents.inspectElement(Math.round(x), Math.round(y))
}

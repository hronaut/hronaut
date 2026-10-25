import { app, Menu, type ContextMenuParams, type MenuItemConstructorOptions, type WebFrameMain } from 'electron'
import { isHronautHomeUrl, isWebUrl } from '../url.js'
import { pageSourceAddress } from '../page-source/page-source.js'
import { searchEngineLabel, selectionAddressKept, selectionGoToUrl, selectionSearchLabelText, selectionSearchQuery, selectionSearchUrl } from '../selection-search/selection-search.js'
import type { PageContextMenuAccess, PageContextMenuTab } from './page-context-menu-access.js'
import { openedResourceReferrer, savedResourceReferrer } from './page-context-menu-referrer.js'
import { textFragmentLink } from './text-fragment-link.js'

// The fields Chrome offers the emoji picker in: an editable element, which has no form control, a text, search,
// address, email or password input, or a text area. A number, telephone or date field takes no emoji.
const EMOJI_FIELDS: ReadonlySet<ContextMenuParams['formControlType']> = new Set(['none', 'input-text', 'input-search', 'input-url', 'input-email', 'input-password', 'text-area'])

/**
 * Shows the native context menu for a right-click in the page: link, image,
 * editing and selection actions for what was clicked, with a link to the
 * selected text and a search for it or a visit to a selected address, then page navigation, copy address, save, print, view source, the
 * source and reload of a frame inside the page, and inspect. Each action checks that its tab is still open.
 */
export function showContextMenu<Tab extends PageContextMenuTab>(access: PageContextMenuAccess<Tab>, tab: Tab, params: ContextMenuParams): void {
  const webContents = tab.webContents
  if (webContents.isDestroyed()) return
  const groups: MenuItemConstructorOptions[][] = []
  const frame = subframe(params.frame)
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
  const reportCopyFailure = (kind: 'text' | 'image', error: unknown): void => {
    console.error(`[browser] Could not copy context-menu ${kind}:`, error)
    access.options().onClipboardCopyFailed?.(error)
  }
  const copyText = (text: string): void => {
    void access.options().copyText(text).catch((error) => reportCopyFailure('text', error))
  }
  // Electron types the frame's referrer policy as a Referrer, but reports the policy name.
  const referrerPolicy = params.referrerPolicy as unknown as string | Partial<Electron.Referrer> | undefined
  const policy = typeof referrerPolicy === 'string' ? referrerPolicy : referrerPolicy?.policy ?? 'default'
  // A sandboxed frame or page has an opaque origin and sends no referrer, as a click in it does. It is read now, since
  // the frame can be gone by the time an item is chosen.
  const sandboxedFrame = hasOpaqueOrigin(params.frame)
  const openBackgroundTab = (url: string): void => {
    const referrer = sandboxedFrame ? undefined : openedResourceReferrer(params.frameURL, policy)
    void access.createTab({
      url,
      active: false,
      mcpGroupId: tab.mcpGroupId,
      openedFrom: { tabId: tab.id, background: true },
      ...(referrer ? { loadOptions: { httpReferrer: referrer } } : {})
    })
      .catch((error) => {
        console.error(`[browser] Could not open context-menu URL ${url}:`, error)
        access.options().onActionFailed?.('open link in new tab', error)
      })
  }
  const download = (url: string, linkName = ''): void => {
    const referrer = sandboxedFrame ? undefined : savedResourceReferrer(params.frameURL, url, policy)
    // Blink gives a same-origin link's `download` name, which Chrome saves the link under.
    if (linkName) access.expectSavedLinkName(webContents, url, linkName)
    if (referrer) webContents.downloadURL(url, { headers: { Referer: referrer } })
    else webContents.downloadURL(url)
  }
  // The search or address opens in front, beside the page and in its workspace, under its navigation policy, and not
  // behind trusted chrome, as View Page Source does not.
  const openSelectionTab = (actionName: string, url: string): (() => void) => withLiveContents(actionName, () => {
    if (access.browserContentOccluded()) return
    void access.createTab({
      url,
      active: true,
      mcpGroupId: tab.mcpGroupId,
      openedFrom: { tabId: tab.id, background: false }
    }).catch((error) => reportActionFailure(actionName, error))
  })
  // Chrome's Search for the selection, with the search engine the address bar uses, read once so the search matches the
  // label, or its Go to for a selected address. As in Chrome, a misspelled word's menu has neither, and neither appears
  // on Hronaut Home, which has no workspace to open them in.
  const searchSelection = (): MenuItemConstructorOptions[] => {
    const query = params.misspelledWord || isHronautHomeUrl(tab.url)
      ? undefined
      : selectionSearchQuery(params.selectionText, params.formControlType === 'input-password')
    if (!query) return []
    const address = selectionGoToUrl(params.selectionText)
    if (address) {
      if (selectionAddressKept(address, params.linkURL)) return []
      return [{
        id: 'go-to-selection',
        label: access.text('native.context.goTo', { text: selectionSearchLabelText(query) }),
        click: openSelectionTab('go to the selected address', address)
      }]
    }
    const engine = access.searchEngine()
    return [{
      id: 'search-selection',
      label: access.text('native.context.searchFor', { engine: searchEngineLabel(engine), text: selectionSearchLabelText(query) }),
      click: openSelectionTab('search for the selection', selectionSearchUrl(query, engine))
    }]
  }
  // Chrome's Copy link to highlight, for text selected in the page itself: a frame inside the page has an address of its
  // own, and Chrome makes no link for text in one either. See text-fragment-link.ts.
  const linkToHighlight = (): MenuItemConstructorOptions[] => {
    if (frame || params.frameURL !== params.pageURL) return []
    const link = textFragmentLink(params.pageURL, params.selectionText)
    return link ? [{ id: 'copy-link-to-highlight', label: access.text('native.context.copyLinkToHighlight'), click: () => copyText(link) }] : []
  }
  const copyImage = (): void => {
    void access.options().copyImageAt(webContents, params.x, params.y)
      .catch((error) => reportCopyFailure('image', error))
  }

  if (params.linkURL) {
    const webLink = isWebUrl(params.linkURL)
    const email = emailAddress(params.linkURL)
    groups.push([
      {
        id: 'open-link-new-tab',
        label: access.text('native.context.openLink'),
        enabled: webLink,
        click: () => openBackgroundTab(params.linkURL)
      },
      {
        id: 'copy-link-address',
        label: access.text(email ? 'native.context.copyEmail' : 'native.context.copyLink'),
        click: () => copyText(email || params.linkURL)
      },
      {
        id: 'save-link',
        label: access.text('native.context.saveLink'),
        enabled: webLink,
        click: withLiveContents('save link', () => download(params.linkURL, params.suggestedFilename))
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
        click: withLiveContents('save image', () => download(params.srcURL))
      }
    ])
  }

  // A video or audio, as in Chrome: open it in a new tab, save it or copy its address. Chromium cannot save a stream a
  // page builds itself, such as one from a MediaSource, and Chrome then neither saves nor opens it, so neither does this.
  // As for an image, only an http or https address opens or saves.
  if ((params.mediaType === 'video' || params.mediaType === 'audio') && params.srcURL) {
    const video = params.mediaType === 'video'
    const savable = isWebUrl(params.srcURL) && params.mediaFlags.canSave
    groups.push([
      {
        id: video ? 'open-video-new-tab' : 'open-audio-new-tab',
        label: access.text(video ? 'native.context.openVideo' : 'native.context.openAudio'),
        enabled: savable,
        click: () => openBackgroundTab(params.srcURL)
      },
      {
        id: video ? 'save-video' : 'save-audio',
        label: access.text(video ? 'native.context.saveVideo' : 'native.context.saveAudio'),
        enabled: savable,
        click: withLiveContents(video ? 'save video' : 'save audio', () => download(params.srcURL))
      },
      {
        id: video ? 'copy-video-address' : 'copy-audio-address',
        label: access.text(video ? 'native.context.copyVideoAddress' : 'native.context.copyAudioAddress'),
        click: () => copyText(params.srcURL)
      }
    ])
  }

  if (params.isEditable) {
    // Windows and macOS open their emoji picker from a text field's menu, as Chrome does, unless the menu suggests
    // spellings; Linux has no picker. A menu takes an ampersand as an access key, so "Emoji & Symbols" doubles it.
    if (!params.misspelledWord && EMOJI_FIELDS.has(params.formControlType) && app.isEmojiPanelSupported()) {
      groups.push([{
        id: 'emoji',
        label: access.text(process.platform === 'darwin' ? 'native.context.emojiSymbols' : 'native.context.emoji').replaceAll('&', '&&'),
        click: withLiveContents('open the emoji picker', () => app.showEmojiPanel())
      }])
    }
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
    const search = searchSelection()
    if (search.length) groups.push(search)
  } else if (params.selectionText) {
    groups.push([
      { id: 'copy-selection', label: access.text('native.context.copy'), click: withLiveContents('copy selection', () => webContents.copy()) },
      ...linkToHighlight(),
      ...searchSelection()
    ])
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
    // Hronaut Home is Hronaut's own page, with nothing on it to save or print. Save As comes before Print, as in Chrome.
    ...isHronautHomeUrl(tab.url) ? [] : [{
      id: 'save-page',
      label: access.text('native.context.savePage'),
      click: withLiveContents('save the page', () => {
        void access.savePage(tab).catch((error) => reportActionFailure('save the page', error))
      })
    }, {
      id: 'print',
      label: access.text('native.context.print'),
      click: withLiveContents('print the page', () => {
        void access.print(tab).catch((error) => access.options().onActionFailed?.('print the page', error))
      })
    }],
    // As in Chrome, between Print and Inspect, for a web page; a page's source has no source of its own.
    ...pageSourceAddress(tab.url) ? [{
      id: 'view-page-source',
      label: access.text('native.context.viewSource'),
      click: withLiveContents('view page source', () => {
        void access.viewSource(tab).catch((error) => reportActionFailure('view page source', error))
      })
    }] : [],
    // A right-click inside a frame of the page offers, as in Chrome, the frame's own source, for a frame showing a web
    // page, and a reload of the frame alone.
    ...frame && !isHronautHomeUrl(tab.url) ? [
      ...pageSourceAddress(params.frameURL) ? [{
        id: 'view-frame-source',
        label: access.text('native.context.viewFrameSource'),
        click: withLiveContents('view frame source', () => {
          void access.viewFrameSource(tab, params.frameURL).catch((error) => reportActionFailure('view frame source', error))
        })
      }] : [],
      {
        id: 'reload-frame',
        label: access.text('native.context.reloadFrame'),
        click: withLiveContents('reload the frame', () => {
          // A frame the page removed while the menu was open has nothing to reload, as in Chrome.
          if (frame.isDestroyed() || frame.detached) return
          frame.reload()
        })
      }
    ] : [],
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

// The characters Chrome keeps escaped when it writes out an address: spaces, controls and characters that show
// nothing or could disguise the text, such as a bidi override or a Hangul filler.
const HIDDEN_CHARACTER = /[\p{White_Space}\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}\p{Noncharacter_Code_Point}\u2800]/u

/**
 * The address of an email link, as Chrome copies it: what follows mailto: up to its subject or body, readable, with its
 * escaped characters written out except a hidden one. Empty when the link is not an email link or names no address, as
 * one that gives it only as a "to" field does.
 */
function emailAddress(linkURL: string): string {
  // As Chromium reads an email link: everything before the "?", with no host and no fragment.
  const address = /^mailto:([^?]*)/iu.exec(linkURL)?.[1] ?? ''
  const decoded = address.replace(/(?:%[0-9a-f]{2})+/giu, (escaped) => {
    try {
      return decodeURIComponent(escaped)
    } catch {
      // Bytes that are not text stay escaped.
      return escaped
    }
  })
  return [...decoded].map(character => HIDDEN_CHARACTER.test(character) ? encodeURIComponent(character) : character).join('')
}

/** The frame inside the page the menu is for: none for the page itself, or for a frame that is already gone. */
function subframe(frame: WebFrameMain | null | undefined): WebFrameMain | undefined {
  if (!frame) return undefined
  try {
    return frame.parent ? frame : undefined
  } catch {
    return undefined
  }
}

function hasOpaqueOrigin(frame: WebFrameMain | null | undefined): boolean {
  if (!frame) return false
  try {
    return frame.origin === 'null'
  } catch {
    // A frame that is already gone cannot show its origin, so it gets no referrer.
    return true
  }
}

async function inspectElement<Tab extends PageContextMenuTab>(access: PageContextMenuAccess<Tab>, tab: Tab, x: number, y: number): Promise<void> {
  if (access.isHumanInteractionLocked(tab) || isHronautHomeUrl(tab.url)) return
  await access.openDevTools(tab)
  const webContents = tab.webContents
  // Inspecting opens Developer Tools by itself, so check again for a tab that shows Home by now.
  if (!webContents.isDestroyed() && !isHronautHomeUrl(tab.url)) webContents.inspectElement(Math.round(x), Math.round(y))
}

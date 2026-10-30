import { app, clipboard, Menu, type ContextMenuParams, type MenuItemConstructorOptions, type WebFrameMain } from 'electron'
import { isHronautHomeUrl, isWebUrl } from '../url.js'
import { pageSourceAddress, viewFrameSource, viewPageSource } from '../page-source/page-source.js'
import { searchEngineLabel, selectionAddressKept, selectionGoToUrl, selectionSearchLabelText, selectionSearchQuery, selectionSearchUrl } from '../selection-search/selection-search.js'
import type { Browser } from '../browser.js'
import { DEFAULT_SEARCH_ENGINE } from '../../../shared/search-engine.js'
import { openDevTools } from '../devtools/devtools.js'
import { printPage } from '../page-print/page-print.js'
import { savePageAs } from '../page-save/page-save.js'
import { openSplitViewAndWait } from '../split-view/split-view.js'
import { strongPasswordSuggestion } from '../suggested-password/suggested-password.js'
import { findTab } from '../browser-core.js'
import type { BrowserTab } from '../browser-tab.js'
import { openedResourceReferrer, savedResourceReferrer } from './page-context-menu-referrer.js'
import { readHighlightPageText } from './highlight-page-text.js'
import { textFragmentLink } from './text-fragment-link.js'
import { LocalizedError } from '../../localized-error.js'
import type { MessageKey } from '../../../shared/i18n.js'
import { mediaPlayerActionAt, type MediaPlayerAction } from './media-player-actions.js'

// The fields Chrome offers the emoji picker in: an editable element, which has no form control, a text, search,
// address, email or password input, or a text area. A number, telephone or date field takes no emoji.
const EMOJI_FIELDS: ReadonlySet<ContextMenuParams['formControlType']> = new Set(['none', 'input-text', 'input-search', 'input-url', 'input-email', 'input-password', 'text-area'])
// Copy link to highlight reads the page before it copies, so a copy the menu made meanwhile is newer and keeps the
// clipboard: each copy the menu makes counts here.
let menuCopies = 0

/**
 * Shows the native context menu for a right-click in the page: link, image,
 * editing and selection actions for what was clicked, with a link to the
 * selected text and a search for it or a visit to a selected address, then page navigation, copy address, save, print, view source, the
 * source and reload of a frame inside the page, and inspect. Each action checks that its tab is still open.
 */
export function showContextMenu(browser: Browser, tab: BrowserTab, params: ContextMenuParams): void {
  const webContents = tab.webContents
  if (webContents.isDestroyed()) return
  const groups: MenuItemConstructorOptions[][] = []
  const frame = subframe(params.frame)
  const reportActionFailure = (action: string, error: unknown): void => {
    console.error(`[browser] Could not ${action} from page context menu:`, error)
    browser.options.onActionFailed?.(action, error)
  }
  const withLiveContents = (actionName: string, action: () => void): (() => void) => () => {
    if (webContents.isDestroyed() || findTab(browser, tab.id) !== tab) {
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
    browser.options.onClipboardCopyFailed?.(error)
  }
  // The shell opens the Create QR Code dialog for the address, in the tab's window.
  const requestQrCode = (address: string): void => {
    browser.window.webContents.send('browser:qr-code-requested', { tabId: tab.id, address })
  }
  const copyText = (text: string): void => {
    menuCopies++
    void browser.options.copyText(text).catch((error) => reportCopyFailure('text', error))
  }
  // Electron types the frame's referrer policy as a Referrer, but reports the policy name.
  const referrerPolicy = params.referrerPolicy as unknown as string | Partial<Electron.Referrer> | undefined
  const policy = typeof referrerPolicy === 'string' ? referrerPolicy : referrerPolicy?.policy ?? 'default'
  // A sandboxed frame or page has an opaque origin and sends no referrer, as a click in it does. It is read now, since
  // the frame can be gone by the time an item is chosen.
  const sandboxedFrame = hasOpaqueOrigin(params.frame)
  const createBackgroundTab = (url: string): Promise<BrowserTab> => {
    const referrer = sandboxedFrame ? undefined : openedResourceReferrer(params.frameURL, policy)
    return browser.createTab({
      url,
      active: false,
      mcpGroupId: tab.mcpGroupId,
      openedFrom: { tabId: tab.id, background: true },
      ...(referrer ? { loadOptions: { httpReferrer: referrer } } : {})
    })
  }
  const openBackgroundTab = (url: string): void => {
    void createBackgroundTab(url)
      .catch((error) => {
        console.error(`[browser] Could not open context-menu URL ${url}:`, error)
        browser.options.onActionFailed?.('open link in new tab', error)
      })
  }
  // Chrome's Open Link in Split View: the link opens in a new tab beside this page, which keeps the keyboard.
  const openLinkInSplitView = (url: string): void => {
    void createBackgroundTab(url)
      .then((created) => showTabBeside(browser, tab, created.id))
      .catch((error) => reportActionFailure('open link in split view', error))
  }
  const download = (url: string, linkName = ''): void => {
    const referrer = sandboxedFrame ? undefined : savedResourceReferrer(params.frameURL, url, policy)
    // Blink gives a same-origin link's `download` name, which Chrome saves the link under.
    if (linkName) browser.downloadController.expectSavedLinkName(webContents.id, url, linkName)
    if (referrer) webContents.downloadURL(url, { headers: { Referer: referrer } })
    else webContents.downloadURL(url)
  }
  // The search or address opens in front, beside the page and in its workspace, under its navigation policy, and not
  // behind trusted chrome, as View Page Source does not.
  const openSelectionTab = (actionName: string, url: string): (() => void) => withLiveContents(actionName, () => {
    if (browser.browserContentOccluded) return
    void browser.createTab({
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
        label: browser.text('native.context.goTo', { text: selectionSearchLabelText(query) }),
        click: openSelectionTab('go to the selected address', address)
      }]
    }
    const engine = browser.options.getSearchEngine?.() ?? DEFAULT_SEARCH_ENGINE
    return [{
      id: 'search-selection',
      label: browser.text('native.context.searchFor', { engine: searchEngineLabel(engine), text: selectionSearchLabelText(query) }),
      click: openSelectionTab('search for the selection', selectionSearchUrl(query, engine))
    }]
  }
  // Chrome's Copy link to highlight, for text selected in the page itself: a frame inside the page has an address of its
  // own, and Chrome makes no link for text in one either. The link is made from the page's text when the item is
  // chosen, and from the menu's selected text when the page cannot give it. See text-fragment-link.ts.
  const linkToHighlight = (): MenuItemConstructorOptions[] => {
    if (frame || params.frameURL !== params.pageURL) return []
    const selectedTextLink = textFragmentLink(params.pageURL, params.selectionText)
    if (!selectedTextLink) return []
    const copyLink = async (): Promise<void> => {
      const copy = ++menuCopies
      // Text copied some other way meanwhile, such as with Ctrl+C, is newer than the link and keeps the clipboard too.
      const [clipboardBefore, page] = await Promise.all([clipboardText(), readHighlightPageText(webContents, params.selectionText)])
      if (copy !== menuCopies) return
      const clipboardNow = await clipboardText()
      if (copy !== menuCopies || clipboardNow !== clipboardBefore) return
      copyText((page && textFragmentLink(params.pageURL, page)) ?? selectedTextLink)
    }
    return [{ id: 'copy-link-to-highlight', label: browser.text('native.context.copyLinkToHighlight'), click: () => void copyLink() }]
  }
  const copyImage = (): void => {
    void browser.options.copyImageAt(webContents, params.x, params.y)
      .catch((error) => reportCopyFailure('image', error))
  }
  // A video's or audio's open, save and copy of its address.
  const addressedMediaItems = (video: boolean, savable: boolean): MenuItemConstructorOptions[] => [
    {
      id: video ? 'open-video-new-tab' : 'open-audio-new-tab',
      label: browser.text(video ? 'native.context.openVideo' : 'native.context.openAudio'),
      enabled: savable,
      click: () => openBackgroundTab(params.srcURL)
    },
    {
      id: video ? 'save-video' : 'save-audio',
      label: browser.text(video ? 'native.context.saveVideo' : 'native.context.saveAudio'),
      enabled: savable,
      click: withLiveContents(video ? 'save video' : 'save audio', () => download(params.srcURL))
    },
    {
      id: video ? 'copy-video-address' : 'copy-audio-address',
      label: browser.text(video ? 'native.context.copyVideoAddress' : 'native.context.copyAudioAddress'),
      click: () => copyText(params.srcURL)
    }
  ]
  // The frame of the page the video or audio is in, as it is when an item is chosen. Electron gives none once it has
  // navigated or gone, and then, as in Chrome, nothing is done to the document now in its place.
  const mediaFrame = (): WebFrameMain | undefined => {
    const current = params.frame
    return current && !current.isDestroyed() && !current.detached ? current : undefined
  }
  // Chrome's Loop and Show controls for a video or audio, and its Picture in picture for a video: each is checked when
  // Chromium said so as the menu opened, and turns that off or on, for the element at the click in the frame it is in.
  // Chromium also says when one is unavailable, such as Loop for a live stream, Picture in picture for a video whose
  // page disallows it, or Show controls for an audio, which hiding its controls would hide.
  const mediaPlayerItem = (id: string, label: MessageKey, action: MediaPlayerAction, available: boolean, checked: boolean): MenuItemConstructorOptions => ({
    id,
    type: 'checkbox',
    label: browser.text(label),
    checked,
    enabled: available && Boolean(params.frame),
    click: withLiveContents(`turn ${action} ${checked ? 'off' : 'on'}`, () => {
      const current = mediaFrame()
      if (!current) return
      void mediaPlayerActionAt(webContents, current, { x: params.x, y: params.y, zoom: webContents.getZoomFactor() }, action, !checked)
        // The page's own error is the page's, so only the action is logged.
        .catch(() => console.error(`[browser] Could not turn ${action} ${checked ? 'off' : 'on'} from page context menu.`))
    })
  })
  // Chrome's Copy Video Frame and Save Video Frame, for the frame the video shows, taken from the frame of the page the
  // video is in, which the click's page coordinates reach even across sites. Electron tells nothing of whether the video
  // has a frame to give, so only a video in error has them unavailable: a copy without a frame reports it failed, and a
  // save without one saves nothing. The save goes through the downloads, as Save Video does.
  const videoFrameItems = (): MenuItemConstructorOptions[] => {
    const enabled = !params.mediaFlags.inError && Boolean(params.frame)
    return [
      {
        id: 'copy-video-frame',
        label: browser.text('native.context.copyVideoFrame'),
        enabled,
        click: withLiveContents('copy video frame', () => {
          const current = mediaFrame()
          if (!current) return
          void browser.options.copyVideoFrameAt(current, params.x, params.y)
            .catch((error) => reportCopyFailure('image', error))
        })
      },
      {
        id: 'save-video-frame',
        label: browser.text('native.context.saveVideoFrame'),
        enabled,
        click: withLiveContents('save video frame', () => mediaFrame()?.saveVideoFrameAs(params.x, params.y))
      }
    ]
  }

  if (params.linkURL) {
    const webLink = isWebUrl(params.linkURL)
    const email = emailAddress(params.linkURL)
    groups.push([
      {
        id: 'open-link-new-tab',
        label: browser.text('native.context.openLink'),
        enabled: webLink,
        click: () => openBackgroundTab(params.linkURL)
      },
      // Hronaut Home is never shown in split view.
      ...isHronautHomeUrl(tab.url) ? [] : [{
        id: 'open-link-split-view',
        label: browser.text('native.context.openLinkSplit'),
        enabled: webLink,
        click: () => openLinkInSplitView(params.linkURL)
      }],
      {
        id: 'copy-link-address',
        label: browser.text(email ? 'native.context.copyEmail' : 'native.context.copyLink'),
        click: () => copyText(email || params.linkURL)
      },
      {
        id: 'save-link',
        label: browser.text('native.context.saveLink'),
        enabled: webLink,
        click: withLiveContents('save link', () => download(params.linkURL, params.suggestedFilename))
      }
    ])
  }

  if (params.mediaType === 'image' && params.srcURL) {
    groups.push([
      {
        id: 'open-image-new-tab',
        label: browser.text('native.context.openImage'),
        enabled: isWebUrl(params.srcURL),
        click: () => openBackgroundTab(params.srcURL)
      },
      {
        id: 'copy-image',
        label: browser.text('native.context.copyImage'),
        enabled: params.hasImageContents,
        click: copyImage
      },
      {
        id: 'copy-image-address',
        label: browser.text('native.context.copyImageAddress'),
        click: () => copyText(params.srcURL)
      },
      // As in Chrome, for an image that is not a link, whose address is http or https.
      ...!params.linkURL && isWebUrl(params.srcURL) ? [{
        id: 'create-qr-code-image',
        label: browser.text('native.context.createQrCodeImage'),
        click: withLiveContents('create a QR code', () => requestQrCode(params.srcURL))
      }] : [],
      {
        id: 'save-image',
        label: browser.text('native.context.saveImage'),
        enabled: isWebUrl(params.srcURL),
        click: withLiveContents('save image', () => download(params.srcURL))
      }
    ])
  }

  // A video or audio, as in Chrome: Loop and Show controls first, then open it in a new tab, save it or copy its
  // address, and for a video, copy or save the frame it shows and Picture in picture. Chromium cannot save a stream a
  // page builds itself, such as one from a MediaSource, and Chrome then neither saves nor opens it, so neither does
  // this. As for an image, only an http or https address opens or saves. A video with no address, such as a camera's,
  // still has its frame items, and an audio without one its Loop and Show controls.
  const video = params.mediaType === 'video'
  if (video || params.mediaType === 'audio') {
    const flags = params.mediaFlags
    groups.push([
      mediaPlayerItem('media-loop', 'native.context.loop', 'loop', flags.canLoop, flags.isLooping),
      mediaPlayerItem('media-controls', 'native.context.showControls', 'controls', flags.canToggleControls, flags.isControlsVisible)
    ])
    const savable = isWebUrl(params.srcURL) && flags.canSave
    const items = [
      ...params.srcURL ? addressedMediaItems(video, savable) : [],
      ...video
        ? [...videoFrameItems(), mediaPlayerItem('picture-in-picture', 'native.context.pictureInPicture', 'picture-in-picture', flags.canShowPictureInPicture, flags.isShowingPictureInPicture)]
        : []
    ]
    if (items.length) groups.push(items)
  }

  if (params.isEditable) {
    // Windows and macOS open their emoji picker from a text field's menu, as Chrome does, unless the menu suggests
    // spellings; Linux has no picker. A menu takes an ampersand as an access key, so "Emoji & Symbols" doubles it.
    if (!params.misspelledWord && EMOJI_FIELDS.has(params.formControlType) && app.isEmojiPanelSupported()) {
      groups.push([{
        id: 'emoji',
        label: browser.text(process.platform === 'darwin' ? 'native.context.emojiSymbols' : 'native.context.emoji').replaceAll('&', '&&'),
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
        label: browser.text('native.context.addDictionary', { word: params.misspelledWord }),
        click: withLiveContents('add word to dictionary', () => { webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord) })
      })
      groups.push(spellingItems)
    }
    groups.push([
      { id: 'undo', label: browser.text('native.context.undo'), enabled: params.editFlags.canUndo, click: withLiveContents('undo', () => webContents.undo()) },
      { id: 'redo', label: browser.text('native.context.redo'), enabled: params.editFlags.canRedo, click: withLiveContents('redo', () => webContents.redo()) },
      { type: 'separator' },
      { id: 'cut', label: browser.text('native.context.cut'), enabled: params.editFlags.canCut, click: withLiveContents('cut', () => webContents.cut()) },
      { id: 'copy', label: browser.text('native.context.copy'), enabled: params.editFlags.canCopy, click: withLiveContents('copy', () => webContents.copy()) },
      { id: 'paste', label: browser.text('native.context.paste'), enabled: params.editFlags.canPaste, click: withLiveContents('paste', () => webContents.paste()) },
      { id: 'paste-and-match-style', label: browser.text('native.context.pasteMatchStyle'), enabled: params.editFlags.canPaste, click: withLiveContents('paste and match style', () => webContents.pasteAndMatchStyle()) },
      { id: 'delete', label: browser.text('native.context.delete'), enabled: params.editFlags.canDelete, click: withLiveContents('delete', () => webContents.delete()) },
      { type: 'separator' },
      { id: 'select-all', label: browser.text('native.context.selectAll'), enabled: params.editFlags.canSelectAll, click: withLiveContents('select all', () => webContents.selectAll()) }
    ])
    // Chrome's Suggest strong password, for a password field of the page itself while passwords can be saved: Hronaut
    // makes the password, fills it in with the field that confirms it, and offers to save it when the page submits it.
    const suggestPassword = params.formControlType === 'input-password' && !frame ? strongPasswordSuggestion(browser, tab) : null
    if (suggestPassword) {
      groups.push([{
        id: 'suggest-strong-password',
        label: browser.text('native.context.suggestStrongPassword'),
        click: withLiveContents('suggest a strong password', () => {
          void suggestPassword().then((filled) => {
            if (!filled) reportActionFailure('suggest a strong password', new LocalizedError('appErrors.credentials.suggestFailed'))
          }, (error: unknown) => reportActionFailure('suggest a strong password', error))
        })
      }])
    }
    const search = searchSelection()
    if (search.length) groups.push(search)
    // Chrome's Spell check submenu turns checking on or off for every website, as Settings does, and, where Settings has
    // spell check languages, opens them. A password field is never checked, so its menu has none.
    if (params.formControlType !== 'input-password') {
      groups.push([{
        id: 'spell-check',
        label: browser.text('native.context.spellCheck'),
        submenu: [{
          id: 'check-spelling',
          type: 'checkbox',
          label: browser.text('native.context.checkSpelling'),
          checked: browser.options.getSpellCheck?.() !== false,
          click: (item) => {
            void setSpellCheck(browser, item.checked).catch((error) => reportActionFailure('change spell check', error))
          }
        }, ...(browser.options.offersSpellCheckLanguages?.() === true
          ? [{
              id: 'spell-check-language-settings',
              label: browser.text('native.context.spellCheckLanguageSettings'),
              click: () => browser.options.openSpellCheckSettings?.()
            }]
          : [])]
      }])
    }
  } else if (params.selectionText) {
    groups.push([
      { id: 'copy-selection', label: browser.text('native.context.copy'), click: withLiveContents('copy selection', () => webContents.copy()) },
      ...linkToHighlight(),
      ...searchSelection()
    ])
  }

  const navigation = webContents.navigationHistory
  groups.push([
    {
      id: 'back',
      label: browser.text('native.context.back'),
      enabled: navigation.canGoBack(),
      click: () => {
        void browser.back(tab.id).catch((error) => browser.options.onActionFailed?.('go back', error))
      }
    },
    {
      id: 'forward',
      label: browser.text('native.context.forward'),
      enabled: navigation.canGoForward(),
      click: () => {
        void browser.forward(tab.id).catch((error) => browser.options.onActionFailed?.('go forward', error))
      }
    },
    {
      id: 'reload',
      label: browser.text('native.context.reload'),
      click: () => {
        void browser.reload(tab.id).catch((error) => browser.options.onActionFailed?.('reload', error))
      }
    },
    {
      id: 'reload-ignoring-cache',
      label: browser.text('native.context.reloadWithoutCache'),
      click: () => {
        void browser.reloadIgnoringCache(tab.id)
          .catch((error) => browser.options.onActionFailed?.('reload without cache', error))
      }
    },
    {
      id: 'copy-page-address',
      label: browser.text('native.context.copyPageAddress'),
      click: () => copyText(tab.url)
    },
    // Hronaut Home is Hronaut's own page, with nothing on it to save or print. Save As comes before Print, as in Chrome.
    ...isHronautHomeUrl(tab.url) ? [] : [{
      id: 'save-page',
      label: browser.text('native.context.savePage'),
      click: withLiveContents('save the page', () => {
        void savePageAs(browser, tab).catch((error) => reportActionFailure('save the page', error))
      })
    }, {
      id: 'print',
      label: browser.text('native.context.print'),
      click: withLiveContents('print the page', () => {
        void printPage(browser, tab).catch((error) => browser.options.onActionFailed?.('print the page', error))
      })
    }],
    // As in Chrome, after Print, for a web page: its address as a QR code, in Hronaut's own dialog.
    ...isWebUrl(tab.url) ? [{
      id: 'create-qr-code-page',
      label: browser.text('native.context.createQrCodePage'),
      click: withLiveContents('create a QR code', () => requestQrCode(tab.url))
    }] : [],
    // As in Chrome, between Print and Inspect, for a web page; a page's source has no source of its own.
    ...pageSourceAddress(tab.url) ? [{
      id: 'view-page-source',
      label: browser.text('native.context.viewSource'),
      click: withLiveContents('view page source', () => {
        void viewPageSource(browser, tab).catch((error) => reportActionFailure('view page source', error))
      })
    }] : [],
    // A right-click inside a frame of the page offers, as in Chrome, the frame's own source, for a frame showing a web
    // page, and a reload of the frame alone.
    ...frame && !isHronautHomeUrl(tab.url) ? [
      ...pageSourceAddress(params.frameURL) ? [{
        id: 'view-frame-source',
        label: browser.text('native.context.viewFrameSource'),
        click: withLiveContents('view frame source', () => {
          void viewFrameSource(browser, tab, params.frameURL).catch((error) => reportActionFailure('view frame source', error))
        })
      }] : [],
      {
        id: 'reload-frame',
        label: browser.text('native.context.reloadFrame'),
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
      label: browser.text('native.context.inspect'),
      click: () => {
        void inspectElement(browser, tab, params.x, params.y)
          .catch((error) => {
            console.error('[browser] Could not inspect the selected element:', error)
            browser.options.onActionFailed?.('inspect element', error)
          })
      }
    }]
  ])

  const template = groups.flatMap((group, index) => index === 0
    ? group
    : [{ type: 'separator' as const }, ...group])
  const menu = Menu.buildFromTemplate(template)
  menu.popup({
    window: browser.window,
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

async function inspectElement(browser: Browser, tab: BrowserTab, x: number, y: number): Promise<void> {
  if (browser.isHumanInteractionLocked(tab) || isHronautHomeUrl(tab.url)) return
  await openDevTools(browser, tab)
  const webContents = tab.webContents
  // Inspecting opens Developer Tools by itself, so check again for a tab that shows Home by now.
  if (!webContents.isDestroyed() && !isHronautHomeUrl(tab.url)) webContents.inspectElement(Math.round(x), Math.round(y))
}

/**
 * Shows a tab beside the page's tab in split view, replacing any other split, while the page's tab is still the one
 * shown; a tab the person went to meanwhile stays in front, and the other tab stays where it opened.
 */
export async function showTabBeside(browser: Browser, tab: BrowserTab, besideTabId: string): Promise<void> {
  if (findTab(browser, tab.id) !== tab || browser.activeTabId !== tab.id) return
  await openSplitViewAndWait(browser, besideTabId, { openedBeside: true })
}

/** Turns spell checking on or off for every website and saves it, as Settings does. */
async function setSpellCheck(browser: Browser, enabled: boolean): Promise<void> {
  await browser.options.setSpellCheck?.(enabled)
}

// The clipboard's text, to tell whether anything was copied since; it stays in main.
function clipboardText(): Promise<string | undefined> {
  return clipboard.readText().catch(() => undefined)
}

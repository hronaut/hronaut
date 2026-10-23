import { clipboard, type BrowserWindow } from 'electron'
import type { MessageKey, MessageParameters } from '../../shared/i18n.js'
import { addressPasteText } from '../../shared/address-paste.js'
import { selectionSearchLabelText } from '../browser/selection-search/selection-search.js'
import { webAddress } from '../browser/url.js'

/** The longest address Chrome loads (url::kMaxURLChars); longer text is not offered. */
const MAX_PASTE_LENGTH = 2 * 1024 * 1024

export interface AddressPasteAndGo {
  label: MessageKey
  parameters?: MessageParameters
  /** Undefined when the clipboard holds no text to open; the item is then shown disabled, as in Chrome. */
  go?: () => void
}

/**
 * Chrome's Paste and Go, or Paste and Search for text that is no address, in the address bar's menu: the clipboard's
 * text, read as the address bar reads a paste, goes to the address bar, which opens it in the tab as Enter does. The
 * label names the text, as Chrome's does, and that text is what opens, whatever the clipboard holds by then. Undefined
 * when the right-click was not in the address bar.
 */
export async function addressPasteAndGo(window: BrowserWindow): Promise<AddressPasteAndGo | undefined> {
  let inAddressBar: boolean
  try {
    // A right-click focuses the field it lands on before the menu opens.
    inAddressBar = await window.webContents.executeJavaScript('document.activeElement?.matches?.(\'input.address[role="combobox"]\') === true') === true
  } catch {
    return undefined
  }
  if (!inAddressBar) return undefined
  let clipboardText = ''
  try {
    clipboardText = await clipboard.readText()
  } catch {
    // A clipboard the system will not read leaves the item disabled, as an empty one does.
  }
  const text = clipboardText.length > MAX_PASTE_LENGTH ? '' : addressPasteText(clipboardText)
  if (!text) return { label: 'native.context.pasteAndGo' }
  return {
    label: webAddress(text) ? 'native.context.pasteAndGoTo' : 'native.context.pasteAndSearchFor',
    parameters: { text: selectionSearchLabelText(text) },
    go: () => { if (!window.isDestroyed()) window.webContents.send('browser:address-paste-and-go', text) }
  }
}

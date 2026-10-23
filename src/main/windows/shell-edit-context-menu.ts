import { app, Menu, type BrowserWindow, type ContextMenuParams, type MenuItemConstructorOptions, type WebContents } from 'electron'
import type { MessageKey, MessageParameters } from '../../shared/i18n.js'
import { addressPasteAndGo, type AddressPasteAndGo } from './address-paste-and-go.js'

type EditContents = Pick<WebContents, 'isDestroyed' | 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'delete' | 'selectAll'>

// The fields Chrome offers the emoji picker in: an editable element, which has no form control, a text, search,
// address, email or password input, or a text area. A number, telephone or date field takes no emoji.
const EMOJI_FIELDS: ReadonlySet<ContextMenuParams['formControlType']> = new Set(['none', 'input-text', 'input-search', 'input-url', 'input-email', 'input-password', 'text-area'])

/**
 * The menu for a right-click in Hronaut's own window: in a text field, such as the address bar, Find or the license
 * key in Settings, the editing actions a page's text field has; on selected text elsewhere, Copy. Electron opens no
 * menu of its own there, so pasting a key took the keyboard. Where the system has an emoji picker, a text field's menu
 * opens it first, as Chrome's address bar does, and the address bar's menu offers Paste and Go after Paste, as Chrome's
 * does. Undefined when there is nothing to offer.
 */
export function shellEditContextMenuItems(
  params: Pick<ContextMenuParams, 'isEditable' | 'selectionText' | 'editFlags' | 'formControlType'>,
  contents: EditContents,
  text: (key: MessageKey, parameters?: MessageParameters) => string,
  emojiPicker?: { label: MessageKey; open: () => void },
  pasteAndGo?: AddressPasteAndGo
): MenuItemConstructorOptions[] | undefined {
  const run = (action: () => void) => () => { if (!contents.isDestroyed()) action() }
  if (params.isEditable) {
    return [
      // A menu takes an ampersand as an access key, so "Emoji & Symbols" doubles it.
      ...emojiPicker && EMOJI_FIELDS.has(params.formControlType) ? [
        { id: 'emoji', label: text(emojiPicker.label).replaceAll('&', '&&'), click: run(emojiPicker.open) },
        { type: 'separator' as const }
      ] : [],
      { id: 'undo', label: text('native.context.undo'), enabled: params.editFlags.canUndo, click: run(() => contents.undo()) },
      { id: 'redo', label: text('native.context.redo'), enabled: params.editFlags.canRedo, click: run(() => contents.redo()) },
      { type: 'separator' },
      { id: 'cut', label: text('native.context.cut'), enabled: params.editFlags.canCut, click: run(() => contents.cut()) },
      { id: 'copy', label: text('native.context.copy'), enabled: params.editFlags.canCopy, click: run(() => contents.copy()) },
      { id: 'paste', label: text('native.context.paste'), enabled: params.editFlags.canPaste, click: run(() => contents.paste()) },
      ...pasteAndGo ? [{
        id: 'paste-and-go',
        label: text(pasteAndGo.label, pasteAndGo.parameters),
        enabled: pasteAndGo.go !== undefined,
        click: run(() => pasteAndGo.go?.())
      }] : [],
      { id: 'delete', label: text('native.context.delete'), enabled: params.editFlags.canDelete, click: run(() => contents.delete()) },
      { type: 'separator' },
      { id: 'select-all', label: text('native.context.selectAll'), enabled: params.editFlags.canSelectAll, click: run(() => contents.selectAll()) }
    ]
  }
  if (params.selectionText) return [{ id: 'copy-selection', label: text('native.context.copy'), click: run(() => contents.copy()) }]
  return undefined
}

/** How long a field's menu waits to learn about Paste and Go before it opens without it. */
const PASTE_AND_GO_WAIT_MS = 500

/**
 * Opens the editing menu on right-clicks in the window's own interface. A click the shell blocks opens none. In the
 * window with the address bar, a field's menu waits, briefly, to learn whether it is the address bar's, for Paste and
 * Go, and a newer right-click takes over from one still waiting, so a late answer never opens a second menu.
 */
export function attachShellEditContextMenu(window: BrowserWindow, text: (key: MessageKey, parameters?: MessageParameters) => string,
  options: { addressBar?: boolean } = {}): void {
  let latestRequest = 0
  window.webContents.on('context-menu', (_event, params) => {
    const request = ++latestRequest
    // Windows and macOS have an emoji picker; Linux has none.
    const emojiPicker = app.isEmojiPanelSupported()
      ? { label: process.platform === 'darwin' ? 'native.context.emojiSymbols' as const : 'native.context.emoji' as const, open: () => app.showEmojiPanel() }
      : undefined
    const show = (pasteAndGo?: AddressPasteAndGo): void => {
      if (window.isDestroyed()) return
      const items = shellEditContextMenuItems(params, window.webContents, text, emojiPicker, pasteAndGo)
      if (items) Menu.buildFromTemplate(items).popup({ window })
    }
    if (!options.addressBar || !params.isEditable) {
      show()
      return
    }
    let settled = false
    const showOnce = (pasteAndGo?: AddressPasteAndGo): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (request === latestRequest) show(pasteAndGo)
    }
    const timer = setTimeout(() => showOnce(), PASTE_AND_GO_WAIT_MS)
    void addressPasteAndGo(window).then(showOnce, () => showOnce())
  })
}

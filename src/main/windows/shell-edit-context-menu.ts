import { Menu, type BrowserWindow, type ContextMenuParams, type MenuItemConstructorOptions, type WebContents } from 'electron'
import type { MessageKey, MessageParameters } from '../../shared/i18n.js'

type EditContents = Pick<WebContents, 'isDestroyed' | 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'delete' | 'selectAll'>

/**
 * The menu for a right-click in Hronaut's own window: in a text field, such as the address bar, Find or the license
 * key in Settings, the editing actions a page's text field has; on selected text elsewhere, Copy. Electron opens no
 * menu of its own there, so pasting a key took the keyboard. Undefined when there is nothing to offer.
 */
export function shellEditContextMenuItems(
  params: Pick<ContextMenuParams, 'isEditable' | 'selectionText' | 'editFlags'>,
  contents: EditContents,
  text: (key: MessageKey, parameters?: MessageParameters) => string
): MenuItemConstructorOptions[] | undefined {
  const run = (action: () => void) => () => { if (!contents.isDestroyed()) action() }
  if (params.isEditable) {
    return [
      { id: 'undo', label: text('native.context.undo'), enabled: params.editFlags.canUndo, click: run(() => contents.undo()) },
      { id: 'redo', label: text('native.context.redo'), enabled: params.editFlags.canRedo, click: run(() => contents.redo()) },
      { type: 'separator' },
      { id: 'cut', label: text('native.context.cut'), enabled: params.editFlags.canCut, click: run(() => contents.cut()) },
      { id: 'copy', label: text('native.context.copy'), enabled: params.editFlags.canCopy, click: run(() => contents.copy()) },
      { id: 'paste', label: text('native.context.paste'), enabled: params.editFlags.canPaste, click: run(() => contents.paste()) },
      { id: 'delete', label: text('native.context.delete'), enabled: params.editFlags.canDelete, click: run(() => contents.delete()) },
      { type: 'separator' },
      { id: 'select-all', label: text('native.context.selectAll'), enabled: params.editFlags.canSelectAll, click: run(() => contents.selectAll()) }
    ]
  }
  if (params.selectionText) return [{ id: 'copy-selection', label: text('native.context.copy'), click: run(() => contents.copy()) }]
  return undefined
}

/** Opens the editing menu on right-clicks in the window's own interface. A click the shell blocks opens none. */
export function attachShellEditContextMenu(window: BrowserWindow, text: (key: MessageKey, parameters?: MessageParameters) => string): void {
  window.webContents.on('context-menu', (_event, params) => {
    const items = shellEditContextMenuItems(params, window.webContents, text)
    if (items && !window.isDestroyed()) Menu.buildFromTemplate(items).popup({ window })
  })
}

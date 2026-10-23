import { describe, expect, it, vi } from 'vitest'
import type { ContextMenuParams, MenuItemConstructorOptions } from 'electron'

const shown = vi.hoisted(() => ({
  templates: [] as MenuItemConstructorOptions[][],
  emojiPanelSupported: false,
  showEmojiPanel: (() => undefined) as () => void,
  clipboard: ''
}))

vi.mock('electron', () => ({
  app: {
    isEmojiPanelSupported: () => shown.emojiPanelSupported,
    showEmojiPanel: () => shown.showEmojiPanel()
  },
  clipboard: { readText: async () => shown.clipboard },
  Menu: {
    buildFromTemplate: (template: MenuItemConstructorOptions[]) => {
      shown.templates.push(template)
      return { popup: () => undefined }
    }
  }
}))

const { attachShellEditContextMenu, shellEditContextMenuItems } = await import('../src/main/windows/shell-edit-context-menu.js')

// A right-click in the license key field in Settings, or any other field of Hronaut's own window, opened no menu,
// so a key could be pasted only with the keyboard.

const allowed = { canUndo: true, canRedo: true, canCut: true, canCopy: true, canPaste: true, canDelete: true, canSelectAll: true, canEditRichly: false }

function contents(destroyed = false) {
  return {
    isDestroyed: () => destroyed,
    undo: vi.fn(), redo: vi.fn(), cut: vi.fn(), copy: vi.fn(), paste: vi.fn(), delete: vi.fn(), selectAll: vi.fn()
  }
}

function params(overrides: Partial<ContextMenuParams>): ContextMenuParams {
  return { isEditable: false, selectionText: '', editFlags: allowed, formControlType: 'input-text', ...overrides } as ContextMenuParams
}

function click(items: MenuItemConstructorOptions[] | undefined, id: string): void {
  const item = items?.find((candidate) => candidate.id === id)
  expect(item).toBeDefined()
  ;(item!.click as () => void)()
}

describe('the editing menu in Hronaut\'s own window', () => {
  it('offers Paste in a text field and pastes into it', () => {
    const target = contents()
    const items = shellEditContextMenuItems(params({ isEditable: true }), target, (key) => key)

    expect(items?.filter((item) => item.id).map((item) => [item.id, item.label])).toEqual([
      ['undo', 'native.context.undo'],
      ['redo', 'native.context.redo'],
      ['cut', 'native.context.cut'],
      ['copy', 'native.context.copy'],
      ['paste', 'native.context.paste'],
      ['delete', 'native.context.delete'],
      ['select-all', 'native.context.selectAll']
    ])
    click(items, 'paste')
    expect(target.paste).toHaveBeenCalledOnce()
  })

  it('enables each action as the field allows it', () => {
    const items = shellEditContextMenuItems(params({ isEditable: true, editFlags: { ...allowed, canPaste: false, canUndo: false } }), contents(), (key) => key)
    expect(items?.find((item) => item.id === 'paste')?.enabled).toBe(false)
    expect(items?.find((item) => item.id === 'undo')?.enabled).toBe(false)
    expect(items?.find((item) => item.id === 'copy')?.enabled).toBe(true)
  })

  it('offers only Copy on selected text outside a field, and nothing elsewhere', () => {
    const target = contents()
    const items = shellEditContextMenuItems(params({ selectionText: 'Hronaut' }), target, (key) => key)
    expect(items?.map((item) => item.id)).toEqual(['copy-selection'])
    click(items, 'copy-selection')
    expect(target.copy).toHaveBeenCalledOnce()

    expect(shellEditContextMenuItems(params({}), target, (key) => key)).toBeUndefined()
  })

  it('opens the emoji picker first in a text field where the system has one, as Chrome\'s address bar does', () => {
    const open = vi.fn()
    const target = contents()
    const items = shellEditContextMenuItems(params({ isEditable: true }), target, (key) => key, { label: 'native.context.emoji', open })
    expect(items?.slice(0, 3).map((item) => item.id ?? item.type)).toEqual(['emoji', 'separator', 'undo'])
    expect(items?.[0]?.label).toBe('native.context.emoji')
    click(items, 'emoji')
    expect(open).toHaveBeenCalledOnce()

    expect(shellEditContextMenuItems(params({ selectionText: 'Hronaut' }), target, (key) => key, { label: 'native.context.emoji', open })
      ?.map((item) => item.id)).toEqual(['copy-selection'])
    click(shellEditContextMenuItems(params({ isEditable: true }), contents(true), (key) => key, { label: 'native.context.emoji', open }), 'emoji')
    expect(open).toHaveBeenCalledOnce()
  })

  it('leaves the emoji picker out of number, telephone and date fields, as Chrome does', () => {
    const picker = { label: 'native.context.emoji' as const, open: vi.fn() }
    for (const field of ['input-number', 'input-telephone', 'input-date'] as const) {
      expect(shellEditContextMenuItems(params({ isEditable: true, formControlType: field }), contents(), (key) => key, picker)?.[0]?.id, field).toBe('undo')
    }
    expect(shellEditContextMenuItems(params({ isEditable: true, formControlType: 'text-area' }), contents(), (key) => key, picker)?.[0]?.id).toBe('emoji')
  })

  it('opens the system\'s emoji picker from a right-click in the window where the system has one', () => {
    const platform = process.platform
    let onContextMenu: ((event: unknown, params: ContextMenuParams) => void) | undefined
    const window = {
      isDestroyed: () => false,
      webContents: { ...contents(), on: (_name: string, listener: typeof onContextMenu) => { onContextMenu = listener } }
    }
    const showEmojiPanel = vi.fn()
    shown.showEmojiPanel = showEmojiPanel
    const text = (key: string) => key === 'native.context.emojiSymbols' ? 'Emoji & Symbols' : key
    attachShellEditContextMenu(window as never, text as never)
    try {
      shown.emojiPanelSupported = true
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
      onContextMenu!({}, params({ isEditable: true }))
      expect(shown.templates.at(-1)?.[0]).toMatchObject({ id: 'emoji', label: 'Emoji && Symbols' })
      click(shown.templates.at(-1), 'emoji')
      expect(showEmojiPanel).toHaveBeenCalledOnce()

      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
      onContextMenu!({}, params({ isEditable: true }))
      expect(shown.templates.at(-1)?.[0]).toMatchObject({ id: 'emoji', label: 'native.context.emoji' })

      shown.emojiPanelSupported = false
      onContextMenu!({}, params({ isEditable: true }))
      expect(shown.templates.at(-1)?.map((item) => item.id)).not.toContain('emoji')
    } finally {
      Object.defineProperty(process, 'platform', { value: platform, configurable: true })
      shown.emojiPanelSupported = false
    }
  })

  it('offers Paste and Go right after Paste when given one, disabled when it has nothing to open', () => {
    const go = vi.fn()
    const text = (key: string, parameters?: Record<string, string | number>) => parameters ? `${key} ${parameters.text}` : key
    const items = shellEditContextMenuItems(params({ isEditable: true }), contents(), text, undefined,
      { label: 'native.context.pasteAndSearchFor', parameters: { text: 'hronaut' }, go })
    expect(items?.filter((item) => item.id).map((item) => item.id)).toEqual(['undo', 'redo', 'cut', 'copy', 'paste', 'paste-and-go', 'delete', 'select-all'])
    expect(items?.find((item) => item.id === 'paste-and-go')).toMatchObject({ label: 'native.context.pasteAndSearchFor hronaut', enabled: true })
    click(items, 'paste-and-go')
    expect(go).toHaveBeenCalledOnce()

    const empty = shellEditContextMenuItems(params({ isEditable: true }), contents(), (key) => key, undefined, { label: 'native.context.pasteAndGo' })
    expect(empty?.find((item) => item.id === 'paste-and-go')).toMatchObject({ label: 'native.context.pasteAndGo', enabled: false })
    click(shellEditContextMenuItems(params({ isEditable: true }), contents(true), (key) => key, undefined, { label: 'native.context.pasteAndGo', go }), 'paste-and-go')
    expect(go).toHaveBeenCalledOnce()
  })

  it('adds Paste and Go to the address bar\'s menu in the main window only, and opens other menus at once', async () => {
    const window = () => {
      const listeners: ((event: unknown, params: ContextMenuParams) => void)[] = []
      const webContents = {
        ...contents(),
        executeJavaScript: vi.fn(async () => true),
        send: vi.fn(),
        on: (_name: string, listener: (event: unknown, params: ContextMenuParams) => void) => { listeners.push(listener) }
      }
      return { value: { isDestroyed: () => false, webContents }, open: (menuParams: ContextMenuParams) => listeners[0]!({}, menuParams) }
    }
    shown.clipboard = 'example.com'

    const main = window()
    attachShellEditContextMenu(main.value as never, ((key: string) => key) as never, { addressBar: true })
    const before = shown.templates.length
    main.open(params({ isEditable: true }))
    expect(shown.templates).toHaveLength(before)
    await vi.waitFor(() => expect(shown.templates).toHaveLength(before + 1))
    expect(shown.templates.at(-1)?.find((item) => item.id === 'paste-and-go')).toMatchObject({ label: 'native.context.pasteAndGoTo', enabled: true })
    click(shown.templates.at(-1), 'paste-and-go')
    expect(main.value.webContents.send).toHaveBeenCalledExactlyOnceWith('browser:address-paste-and-go', 'example.com')

    // Another field of the main window gets the plain menu once the window says so.
    main.value.webContents.executeJavaScript.mockResolvedValueOnce(false)
    main.open(params({ isEditable: true }))
    await vi.waitFor(() => expect(shown.templates).toHaveLength(before + 2))
    expect(shown.templates.at(-1)?.map((item) => item.id)).not.toContain('paste-and-go')

    // Selected text outside a field, and every field of the panel window, open their menu without asking.
    main.open(params({ selectionText: 'Hronaut' }))
    expect(shown.templates.at(-1)?.map((item) => item.id)).toEqual(['copy-selection'])
    const panel = window()
    attachShellEditContextMenu(panel.value as never, ((key: string) => key) as never)
    panel.open(params({ isEditable: true }))
    expect(shown.templates).toHaveLength(before + 4)
    expect(shown.templates.at(-1)?.map((item) => item.id)).not.toContain('paste-and-go')
    expect(panel.value.webContents.executeJavaScript).not.toHaveBeenCalled()
    expect(main.value.webContents.executeJavaScript).toHaveBeenCalledTimes(2)
    shown.clipboard = ''
  })

  it('opens only the newest right-click\'s menu, the plain one when the window is slow to answer, and none once it has closed', async () => {
    vi.useFakeTimers()
    try {
      const listeners: ((event: unknown, params: ContextMenuParams) => void)[] = []
      const answers: ((focusedAddressBar: boolean) => void)[] = []
      let destroyed = false
      const webContents = {
        ...contents(),
        executeJavaScript: vi.fn(() => new Promise<boolean>((resolve) => { answers.push(resolve) })),
        send: vi.fn(),
        on: (_name: string, listener: (event: unknown, params: ContextMenuParams) => void) => { listeners.push(listener) }
      }
      attachShellEditContextMenu({ isDestroyed: () => destroyed, webContents } as never, ((key: string) => key) as never, { addressBar: true })
      shown.clipboard = 'example.com'
      const before = shown.templates.length
      const open = (menuParams: ContextMenuParams) => listeners[0]!({}, menuParams)

      // A right-click on selected text after one in the address bar takes over, and the late answer opens no second menu.
      open(params({ isEditable: true }))
      open(params({ selectionText: 'Hronaut' }))
      answers[0]!(true)
      await vi.advanceTimersByTimeAsync(1000)
      expect(shown.templates.slice(before).map((template) => template.map((item) => item.id))).toEqual([['copy-selection']])

      // A window slow to answer gets the plain menu after a moment, and its late answer opens nothing more.
      open(params({ isEditable: true }))
      await vi.advanceTimersByTimeAsync(499)
      expect(shown.templates).toHaveLength(before + 1)
      await vi.advanceTimersByTimeAsync(1)
      expect(shown.templates).toHaveLength(before + 2)
      expect(shown.templates.at(-1)?.map((item) => item.id)).not.toContain('paste-and-go')
      answers[1]!(true)
      await vi.advanceTimersByTimeAsync(1000)
      expect(shown.templates).toHaveLength(before + 2)

      // A window that closes while the menu waits opens none.
      open(params({ isEditable: true }))
      destroyed = true
      answers[2]!(true)
      await vi.advanceTimersByTimeAsync(1000)
      expect(shown.templates).toHaveLength(before + 2)
    } finally {
      vi.useRealTimers()
      shown.clipboard = ''
    }
  })

  it('does nothing once the window has closed', () => {
    const target = contents(true)
    click(shellEditContextMenuItems(params({ isEditable: true }), target, (key) => key), 'paste')
    expect(target.paste).not.toHaveBeenCalled()
  })
})

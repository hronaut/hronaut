import { describe, expect, it, vi } from 'vitest'
import type { ContextMenuParams, MenuItemConstructorOptions } from 'electron'

vi.mock('electron', () => ({ Menu: { buildFromTemplate: () => ({ popup: () => undefined }) } }))

const { shellEditContextMenuItems } = await import('../src/main/windows/shell-edit-context-menu.js')

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
  return { isEditable: false, selectionText: '', editFlags: allowed, ...overrides } as ContextMenuParams
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

  it('does nothing once the window has closed', () => {
    const target = contents(true)
    click(shellEditContextMenuItems(params({ isEditable: true }), target, (key) => key), 'paste')
    expect(target.paste).not.toHaveBeenCalled()
  })
})

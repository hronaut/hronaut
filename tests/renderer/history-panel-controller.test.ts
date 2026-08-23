import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useHistoryPanelController } from '../../src/renderer/src/composables/useHistoryPanelController.js'
import type { BrowserHistoryEntry } from '../../src/shared/types.js'

function entry(id: string, title = `Page ${id}`, visitCount = 1): BrowserHistoryEntry {
  return {
    id,
    url: `https://example.test/${id}`,
    title,
    visitedAt: '2026-08-22T09:30:00.000Z',
    visitCount
  }
}

function createController(initialEntries = [entry('alpha')]) {
  const open = ref(false)
  const entries = ref(initialEntries)
  const listHistory = vi.fn(async () => entries.value)
  const removeHistoryEntry = vi.fn(async (id: string) => entries.value.filter((item) => item.id !== id))
  const clearHistory = vi.fn(async () => [])
  const openHistoryEntry = vi.fn(async () => undefined)
  const confirmClear = vi.fn(() => true)
  const controller = useHistoryPanelController({
    open,
    entries,
    translate: (key, parameters) => key === 'history.visits' ? `${parameters?.count} visits` : key,
    formatDateTime: () => 'Aug 22, 2026, 12:30 PM',
    formatNumber: String,
    listHistory,
    removeHistoryEntry,
    clearHistory,
    openHistoryEntry,
    confirmClear
  })
  return {
    open,
    entries,
    listHistory,
    removeHistoryEntry,
    clearHistory,
    openHistoryEntry,
    confirmClear,
    controller
  }
}

describe('history panel controller', () => {
  it('opens the panel and reports a load failure instead of rejecting outside the UI', async () => {
    const { open, entries, listHistory, controller } = createController()
    listHistory.mockRejectedValueOnce(new Error('History storage is unavailable'))

    await controller.toggle()

    expect(open.value).toBe(true)
    expect(entries.value).toHaveLength(1)
    expect(controller.error.value).toBe('History storage is unavailable')
    expect(controller.pendingAction.value).toBeNull()

    await controller.toggle()
    await controller.toggle()
    expect(listHistory).toHaveBeenCalledTimes(2)
    expect(controller.error.value).toBe('')
  })

  it('keeps the panel open when opening an entry fails and closes only after success', async () => {
    const { open, openHistoryEntry, controller } = createController()
    open.value = true
    openHistoryEntry.mockRejectedValueOnce(new Error('Could not open the page'))

    await controller.openEntry(entry('alpha'))
    expect(open.value).toBe(true)
    expect(controller.error.value).toBe('Could not open the page')

    await controller.openEntry(entry('alpha'))
    expect(open.value).toBe(false)
  })

  it('deduplicates overlapping mutations and accepts the authoritative result', async () => {
    let resolveRemove: ((entries: BrowserHistoryEntry[]) => void) | undefined
    const pendingRemove = new Promise<BrowserHistoryEntry[]>((resolve) => {
      resolveRemove = resolve
    })
    const { entries, removeHistoryEntry, controller } = createController([entry('alpha'), entry('beta')])
    removeHistoryEntry.mockReturnValue(pendingRemove)

    const first = controller.remove('alpha')
    const duplicate = controller.remove('alpha')
    expect(removeHistoryEntry).toHaveBeenCalledTimes(1)
    expect(controller.pendingAction.value).toBe('remove:alpha')

    resolveRemove?.([entry('beta')])
    await Promise.all([first, duplicate])

    expect(entries.value.map((item) => item.id)).toEqual(['beta'])
    expect(controller.pendingAction.value).toBeNull()
  })

  it('requires confirmation before clearing and filters titles and addresses', async () => {
    const { entries, clearHistory, confirmClear, controller } = createController([
      entry('alpha', 'Alpha docs', 3),
      entry('beta', 'Beta page')
    ])
    confirmClear.mockReturnValueOnce(false)

    await controller.clear()
    expect(clearHistory).not.toHaveBeenCalled()
    expect(entries.value).toHaveLength(2)

    controller.query.value = 'EXAMPLE.TEST/BETA'
    expect(controller.filteredEntries.value.map((item) => item.id)).toEqual(['beta'])
    expect(controller.entryMeta(entries.value[0])).toBe('Aug 22, 2026, 12:30 PM · 3 visits')
  })
})

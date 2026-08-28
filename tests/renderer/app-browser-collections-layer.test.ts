import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import AppBrowserCollectionsLayer from '../../src/renderer/src/components/AppBrowserCollectionsLayer.vue'
import type { AppBrowserCollectionsFeatureController } from '../../src/renderer/src/composables/useAppBrowserCollectionsFeatureController.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowserBookmark, BrowserHistoryEntry } from '../../src/shared/types.js'

const global = { plugins: [createHronautI18n('en-US')] }

function createController() {
  const downloadsOpen = ref(true)
  const bookmarksOpen = ref(false)
  const historyOpen = ref(false)
  const bookmarks = ref<BrowserBookmark[]>([])
  const visitHistory = ref<BrowserHistoryEntry[]>([])
  const addBookmark = vi.fn(async () => bookmarks.value)
  const openBookmark = vi.fn(async () => undefined)
  const openHistoryEntry = vi.fn(async () => undefined)
  const controller = {
    browserCollectionsController: {
      cancelDownload: vi.fn(async () => []),
      clearFinishedDownloads: vi.fn(async () => []),
      revealDownload: vi.fn(async () => undefined),
      refreshBookmarks: vi.fn(async () => bookmarks.value),
      addBookmark,
      renameBookmark: vi.fn(async () => bookmarks.value),
      removeBookmark: vi.fn(async () => bookmarks.value),
      refreshHistory: vi.fn(async () => visitHistory.value),
      removeHistoryEntry: vi.fn(async () => visitHistory.value),
      clearHistory: vi.fn(async () => visitHistory.value)
    },
    downloads: ref([]),
    bookmarks,
    visitHistory,
    downloadsOpen,
    bookmarksOpen,
    bookmarksPanel: ref(null),
    historyOpen,
    historyPanel: ref(null),
    openBookmark,
    openHistoryEntry
  } as unknown as AppBrowserCollectionsFeatureController

  return {
    controller,
    downloadsOpen,
    bookmarksOpen,
    historyOpen,
    addBookmark,
    openBookmark,
    openHistoryEntry
  }
}

describe('AppBrowserCollectionsLayer', () => {
  it('owns collection panel visibility and exposes panel surfaces to the shell controller', async () => {
    const harness = createController()
    render(AppBrowserCollectionsLayer, {
      global,
      props: {
        controller: harness.controller,
        dock: 'right',
        activeUrl: 'https://example.test/app',
        activeTitle: 'Example',
        formatBytes: String,
        formatPercent: String,
        formatDateTime: String,
        formatNumber: String
      }
    })
    const user = userEvent.setup()

    expect(screen.getByRole('dialog', { name: 'Downloads' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Close downloads' }))
    expect(harness.downloadsOpen.value).toBe(false)

    harness.bookmarksOpen.value = true
    await nextTick()
    expect(screen.getByRole('dialog', { name: 'Bookmarks' })).toBeVisible()
    expect(harness.controller.bookmarksPanel.value).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'Add current' }))
    expect(harness.addBookmark).toHaveBeenCalledWith('https://example.test/app', 'Example')

    harness.bookmarksOpen.value = false
    harness.historyOpen.value = true
    await nextTick()
    expect(screen.getByRole('dialog', { name: 'Browsing history' })).toBeVisible()
    expect(harness.controller.historyPanel.value).not.toBeNull()
  })
})

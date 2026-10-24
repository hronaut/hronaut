import { computed, ref, watch, type Ref } from 'vue'
import type { BrowserBookmark } from '../../../shared/types.js'
import { friendlyUiError } from './useAppToastController.js'

/** Chrome asks first when Open all would open this many tabs or more. */
export const OPEN_ALL_ASKS_FROM = 15

export interface BookmarksOpenAllOptions {
  /** The bookmarks the list shows, in its order. */
  bookmarks: Readonly<Ref<readonly BrowserBookmark[]>>
  open: Readonly<Ref<boolean>>
  /** Another bookmark change is under way. */
  blocked: Readonly<Ref<boolean>>
  openInBackground: (bookmark: BrowserBookmark) => Promise<void>
  /** Words for a failure that carries none of its own. */
  translate: (key: string) => string
}

/**
 * Chrome's Open all for the bookmarks the list shows: each opens in a background tab, in the list's order, after a
 * question when that is 15 tabs or more. It belongs to the panel rather than to its buttons, so closing and reopening
 * the panel while tabs open neither starts a second run nor loses what the first one did. A change to the list drops
 * the question, so it is never answered for bookmarks the list no longer shows.
 */
export function useBookmarksOpenAll(options: BookmarksOpenAllOptions) {
  const pending = ref(false)
  const asking = ref(false)
  /** How many tabs the last run opened. */
  const opened = ref(0)
  const error = ref('')

  const listKey = computed(() => options.bookmarks.value.map(bookmark => `${bookmark.id}:${bookmark.url}`).join('\n'))
  watch(listKey, () => {
    asking.value = false
    opened.value = 0
    error.value = ''
  }, { flush: 'sync' })
  watch(options.open, isOpen => { if (!isOpen) asking.value = false }, { flush: 'sync' })

  const available = () => !pending.value && !options.blocked.value && options.bookmarks.value.length > 0

  async function run(): Promise<void> {
    const bookmarks = [...options.bookmarks.value]
    pending.value = true
    opened.value = 0
    error.value = ''
    let count = 0
    try {
      for (const bookmark of bookmarks) {
        await options.openInBackground(bookmark)
        count += 1
      }
    } catch (cause) {
      // Opening stops at the first tab that cannot open, such as at Hronaut's tab limit.
      error.value = friendlyUiError(cause, options.translate('runtime.toast.actionFailed'))
    } finally {
      pending.value = false
      opened.value = count
    }
  }

  /** Open all: opens them at once, or asks first. */
  function request(): void {
    if (asking.value || !available()) return
    if (options.bookmarks.value.length < OPEN_ALL_ASKS_FROM) {
      void run()
      return
    }
    opened.value = 0
    error.value = ''
    asking.value = true
  }

  function confirm(): void {
    if (!asking.value || !available()) return
    asking.value = false
    void run()
  }

  /** Drops the question; whether there was one to drop. */
  function cancel(): boolean {
    if (!asking.value) return false
    asking.value = false
    return true
  }

  return { pending, asking, opened, error, request, confirm, cancel }
}

export type BookmarksOpenAllController = ReturnType<typeof useBookmarksOpenAll>

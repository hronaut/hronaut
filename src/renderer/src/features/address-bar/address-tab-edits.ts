import type { AddressKeyword } from '../../address-keyword-search.js'

/** What the person typed in the address field for a tab and did not send, with the engine of a keyword search. */
export interface AddressTabEdit {
  text: string
  keyword: AddressKeyword | null
}

/**
 * The address field's unsent edits of the tabs the person left, as Chrome keeps them: coming back to a tab shows what
 * was typed for it again, while the tab still shows the page it showed then. A tab that opened another page since shows
 * that page's address.
 */
export function createAddressTabEdits() {
  const edits = new Map<string, AddressTabEdit & { url: string | undefined }>()

  /** Keeps the edit of the tab left, and forgets those of tabs that are closed. */
  function keep(tabId: string, url: string | undefined, edit: AddressTabEdit, openTabs: readonly { id: string }[]): void {
    edits.set(tabId, { ...edit, url })
    const open = new Set(openTabs.map(tab => tab.id))
    for (const id of edits.keys()) {
      if (!open.has(id)) edits.delete(id)
    }
  }

  /** The edit kept for the tab come back to, once. */
  function take(tabId: string, url: string | undefined): AddressTabEdit | undefined {
    const edit = edits.get(tabId)
    edits.delete(tabId)
    return edit && edit.url === url ? { text: edit.text, keyword: edit.keyword } : undefined
  }

  return { keep, take, clear: () => edits.clear() }
}

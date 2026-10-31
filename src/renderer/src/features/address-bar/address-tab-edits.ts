import type { AddressKeyword } from '../../address-keyword-search.js'

/** What the person typed in the address field for a tab and did not send, with the engine of a keyword search. */
export interface AddressTabEdit {
  text: string
  keyword: AddressKeyword | null
}

/** The page a tab showed when an edit was typed over it: its address and its count of navigations. */
interface TabPage {
  url: string | undefined
  navigationGeneration: number | undefined
}

/**
 * The address field's unsent edits of the tabs the person left, as Chrome keeps them: coming back to a tab shows what
 * was typed for it again while the tab still shows the page it showed then. A tab that moved on meanwhile, even to the
 * same address again, shows its page's address, as Chrome drops the edit of a tab whose address changes.
 */
export function createAddressTabEdits() {
  const edits = new Map<string, AddressTabEdit & TabPage>()

  // Edits of tabs that closed are forgotten.
  function forgetClosed(openTabs: readonly { id: string }[]): void {
    const open = new Set(openTabs.map(tab => tab.id))
    for (const id of edits.keys()) {
      if (!open.has(id)) edits.delete(id)
    }
  }

  /** Keeps the edit of the tab left. */
  function keep(tabId: string, page: TabPage, edit: AddressTabEdit, openTabs: readonly { id: string }[]): void {
    edits.set(tabId, { ...edit, ...page })
    forgetClosed(openTabs)
  }

  /** The edit kept for the tab come back to, once. */
  function take(tabId: string, page: TabPage, openTabs: readonly { id: string }[]): AddressTabEdit | undefined {
    const edit = edits.get(tabId)
    edits.delete(tabId)
    forgetClosed(openTabs)
    const samePage = edit?.url === page.url && edit?.navigationGeneration === page.navigationGeneration
    return edit && samePage ? { text: edit.text, keyword: edit.keyword } : undefined
  }

  return { keep, take, clear: () => edits.clear() }
}

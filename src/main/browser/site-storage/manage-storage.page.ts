/** What the page answers a storage action: that it changed first, or whether the action changed the storage and its items. */
export type WebStorageAnswer = { pageChanged: true } | { changed: boolean; itemCount: number; items: Array<[string, string]> }

/**
 * Runs in the page at href: reads, sets, deletes or clears an item of its local or session storage, then returns
 * whether that changed it, how many items it holds and, for get, that item, else every item sorted by key.
 */
export function webStorageInPage(
  href: string,
  storageName: 'localStorage' | 'sessionStorage',
  action: string,
  key: string | undefined,
  value: string | undefined
): WebStorageAnswer {
  if (window.location.href !== href) {
    return { pageChanged: true }
  }
  const storage = window[storageName]
  let changed = false
  if (action === 'set') { storage.setItem(key!, value!); changed = true }
  else if (action === 'delete') { changed = storage.getItem(key!) !== null; storage.removeItem(key!) }
  else if (action === 'clear') { changed = storage.length > 0; storage.clear() }
  const items: Array<[string, string]> = []
  if (action === 'get') {
    const itemValue = storage.getItem(key!)
    if (itemValue !== null) items.push([key!, itemValue])
  } else {
    for (let index = 0; index < storage.length; index += 1) {
      const itemKey = storage.key(index)
      if (itemKey !== null) items.push([itemKey, storage.getItem(itemKey) ?? ''])
    }
    items.sort((left, right) => left[0].localeCompare(right[0]))
  }
  return { changed, itemCount: storage.length, items }
}

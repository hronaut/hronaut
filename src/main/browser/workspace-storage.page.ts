/** Runs in the origin's storage page: every key and value of its local storage, in the storage's order. */
export function readLocalStorageInPage(): Array<[string, string]> {
  const items: Array<[string, string]> = []
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (key !== null) items.push([key, localStorage.getItem(key) ?? ''])
  }
  return items
}

/** Runs in the origin's storage page: sets each of these keys to its value. */
export function mergeLocalStorageInPage(items: Array<[string, string]>): void {
  for (const [key, value] of items) localStorage.setItem(key, value)
}

/**
 * Runs in the origin's storage page: removes each of these keys that still holds the value copied, and counts the keys
 * now gone, those already gone included.
 */
export function removeUnchangedLocalStorageInPage(items: Array<[string, string]>): number {
  let removed = 0
  for (const [key, value] of items) {
    if (localStorage.getItem(key) === null) { removed += 1; continue }
    if (localStorage.getItem(key) !== value) continue
    localStorage.removeItem(key)
    if (localStorage.getItem(key) === null) removed += 1
  }
  return removed
}

/**
 * Runs in the origin's storage page: gives each key that still holds the value copied its previous value back, or
 * removes it when it had none.
 */
export function restoreLocalStorageInPage(previousItems: Array<[string, string]>, items: Array<[string, string]>): void {
  const previous = new Map(previousItems)
  for (const [key, copiedValue] of items) {
    if (localStorage.getItem(key) !== copiedValue) continue
    if (previous.has(key)) localStorage.setItem(key, previous.get(key)!)
    else localStorage.removeItem(key)
  }
}

import type { BrowserState } from '../../../shared/types.js'

/** Each part of a state as it arrived, written out once, which is how the next state's parts are compared with it. */
const written = new WeakMap<object, string>()

function writtenOut(value: object): string {
  let text = written.get(value)
  if (text === undefined) {
    text = JSON.stringify(value)
    written.set(value, text)
  }
  return text
}

/** The next list, holding the previous list's item for each item that did not change, or the previous list itself. */
function reuseItems<Item extends { id: string }>(previous: readonly Item[], next: Item[]): Item[] {
  const previousById = new Map(previous.map(item => [item.id, item]))
  let unchanged = previous.length === next.length
  const items = next.map((item, index) => {
    const kept = previousById.get(item.id)
    if (kept && writtenOut(kept) === writtenOut(item)) {
      if (previous[index] !== kept) unchanged = false
      return kept
    }
    unchanged = false
    return item
  })
  return unchanged ? previous as Item[] : items
}

/**
 * The next browser state, keeping the shell's own object for each tab, closed tab and workspace that did not change,
 * and its own list where none did. Main sends every tab whenever anything changes, so many pages loading together
 * would otherwise draw every tab again for each change of one: a tab's row now draws again only when its tab changed.
 */
export function reuseUnchangedBrowserState(previous: BrowserState, next: BrowserState): BrowserState {
  return {
    ...next,
    tabs: reuseItems(previous.tabs, next.tabs),
    closedTabs: reuseItems(previous.closedTabs, next.closedTabs),
    mcpTabGroups: reuseItems(previous.mcpTabGroups, next.mcpTabGroups),
    savedTabGroups: reuseItems(previous.savedTabGroups, next.savedTabGroups)
  }
}

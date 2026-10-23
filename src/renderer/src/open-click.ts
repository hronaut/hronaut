/**
 * Where a click on something that opens a page, such as a bookmark or a visit in History, opens it, by Chrome's rules
 * for a link: a middle-click or Ctrl+click (⌘-click on a Mac) opens it in a new tab behind, and with Shift in a new tab
 * in front. Undefined for a plain click, and for Shift+click, which opens a new window in Chrome and Hronaut has none.
 */
export function openClickTab(event: MouseEvent, mac: boolean): 'new-tab' | 'new-background-tab' | undefined {
  if (event.button !== 1 && !(mac ? event.metaKey : event.ctrlKey)) return undefined
  return event.shiftKey ? 'new-tab' : 'new-background-tab'
}

/** Takes a middle-click on an enabled button as a click, as Chrome does for a link, and keeps it from also pasting, as on Linux. */
export function asMiddleClick(event: MouseEvent, click: (event: MouseEvent) => void): void {
  if (event.button !== 1 || (event.currentTarget instanceof HTMLButtonElement && event.currentTarget.disabled)) return
  event.preventDefault()
  click(event)
}

/**
 * The title Hronaut gives a blank tab until a page names it. Agents, saved
 * sessions and history keep this English title; the interface shows its own.
 */
export const UNTITLED_TAB_TITLE = 'New tab'

/**
 * A tab's title as the interface shows it. A tab without a title, or a blank
 * tab that still has the untitled title, reads as `untitled`: the interface
 * language's own name for it.
 */
export function tabTitleForDisplay(tab: { title: string; url: string }, untitled: string): string {
  return !tab.title || (tab.title === UNTITLED_TAB_TITLE && tab.url === 'about:blank') ? untitled : tab.title
}

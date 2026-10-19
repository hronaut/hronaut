/**
 * The title Hronaut gives a blank tab until a page names it. Agents, saved
 * sessions and history keep this English title; the interface shows its own.
 */
export const UNTITLED_TAB_TITLE = 'New tab'

/**
 * A tab's title as the interface shows it. A tab without a title, a blank tab
 * that still has the untitled title, and a tab whose first page is loading
 * under that title read as `newTabName`: the interface language's name for a
 * new tab.
 */
export function tabTitleForDisplay(tab: { title: string; url: string; loading?: boolean }, newTabName: string): string {
  const untitled = !tab.title || (tab.title === UNTITLED_TAB_TITLE && (tab.url === 'about:blank' || tab.loading === true))
  return untitled ? newTabName : tab.title
}

import { openClickTab } from './open-click.js'

/**
 * What a click on Back, Forward or Reload does with the middle button or modifier keys, by the rules of Chrome's toolbar:
 * - a middle-click opens the button's page in a new background tab, and with Shift in a new tab in front;
 * - Ctrl+click (⌘-click on a Mac) on Back or Forward does the same;
 * - Shift+click or Ctrl+click on Reload reloads without the cache, and ⌘-click on a Mac opens the page in a new
 *   background tab, as Chrome takes Shift and Ctrl on Reload for the cache rather than for where the page opens.
 * Chrome's Shift+click on Back or Forward opens a new window, which Hronaut has not, so it goes there as a plain click
 * does; so does any other combination.
 */
export type ToolbarClickAction = 'new-tab' | 'new-background-tab' | 'reload-ignoring-cache'

export function toolbarClickAction(button: 'back' | 'forward' | 'reload', event: MouseEvent, mac: boolean): ToolbarClickAction | undefined {
  if (button !== 'reload') return openClickTab(event, mac)
  if (event.button === 1 || (mac && event.metaKey)) return 'new-background-tab'
  return event.shiftKey || event.ctrlKey ? 'reload-ignoring-cache' : undefined
}

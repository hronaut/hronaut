import type { ActionTarget } from '../page-scripts/target-action.page.js'

/**
 * Runs in the page: scrolls the element the target names, or the page itself when there is no target, by these
 * deltas at once, and gives its scroll position after.
 */
export function scrollTargetInPage(
  target: ActionTarget | null,
  deltaX: number,
  deltaY: number,
  targetElement: (target: ActionTarget) => Element | null
): { x: number; y: number } {
  const element = target ? targetElement(target) : document.scrollingElement
  if (!element) throw new Error('Scroll target not found.')
  if (element === document.scrollingElement) window.scrollBy({ left: deltaX, top: deltaY, behavior: 'instant' })
  else element.scrollBy({ left: deltaX, top: deltaY, behavior: 'instant' })
  return { x: element.scrollLeft ?? window.scrollX, y: element.scrollTop ?? window.scrollY }
}

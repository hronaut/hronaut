import type { ActionTarget } from '../page-scripts/target-action.page.js'

/** A rectangle of the page, in CSS pixels from the document's top left corner. */
interface PageClip {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Runs in the page: scrolls the element the target names to the middle of the viewport, waits two frames, and gives
 * the part of the document it covers; throws `missing` when there is no such element and `hidden` when it has no area.
 */
export async function screenshotTargetClipInPage(
  target: ActionTarget,
  targetElement: (target: ActionTarget) => Element | null,
  missing: string,
  hidden: string
): Promise<PageClip> {
  const element = targetElement(target)
  if (!element) throw new Error(missing)
  element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) throw new Error(hidden)
  const x = Math.max(0, rect.left + scrollX)
  const y = Math.max(0, rect.top + scrollY)
  return {
    x,
    y,
    width: Math.min(rect.width - Math.max(0, -(rect.left + scrollX)), document.documentElement.scrollWidth - x),
    height: Math.min(rect.height - Math.max(0, -(rect.top + scrollY)), document.documentElement.scrollHeight - y)
  }
}

/** Runs in the page: the viewport rectangle given as the part of the document it shows; throws when it does not fit the viewport. */
export function screenshotClipInPage(clip: PageClip): PageClip {
  if (clip.x + clip.width > innerWidth || clip.y + clip.height > innerHeight) {
    throw new Error('Screenshot clip must fit inside the visible viewport.')
  }
  return { x: scrollX + clip.x, y: scrollY + clip.y, width: clip.width, height: clip.height }
}

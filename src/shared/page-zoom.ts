/**
 * The page zoom steps that zoom in and out move through, in percent: Chrome's (kPresetBrowserZoomFactorsArray), with a
 * third and two thirds as 33% and 67%. Their ends are the lowest and highest zoom a page can have, as in Chrome.
 */
export const PAGE_ZOOM_STEPS = [25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500] as const

export const PAGE_ZOOM_LIMITS = { min: PAGE_ZOOM_STEPS[0], max: PAGE_ZOOM_STEPS.at(-1)! } as const

/**
 * The zoom factor for a percent: 33% and 67% are Chrome's exact third and two thirds, so a page lays out at the widths
 * it has in Chrome there, such as 1920 CSS pixels at 67% of a window 1280 pixels wide, not 1910.
 */
export function pageZoomFactor(percent: number): number {
  if (percent === 33) return 1 / 3
  if (percent === 67) return 2 / 3
  return percent / 100
}

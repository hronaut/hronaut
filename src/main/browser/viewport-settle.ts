export interface PageViewportSize {
  width: number
  height: number
  devicePixelRatio: number
}

/** How long a viewport reset waits for the page to take its view's size, in milliseconds. */
export const VIEWPORT_RESET_SETTLE_MS = 1_000
const VIEWPORT_RESET_POLL_MS = 25

export interface ViewportSettleClock {
  now(): number
  wait(ms: number): Promise<void>
}

const realClock: ViewportSettleClock = {
  now: () => performance.now(),
  wait: ms => new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Without a viewport override the page takes its view's size, but Chromium can hand the renderer that size a moment
 * after the override goes, such as when the view was resized just before. Reads the page until its size matches the
 * view, within a CSS pixel of zoom rounding, and returns the last read once it does or the wait runs out. A null view
 * size, such as for a tab that closed, ends the wait at once.
 */
export async function settledViewportSize(
  read: () => Promise<PageViewportSize>,
  viewSize: () => { width: number; height: number } | null,
  clock: ViewportSettleClock = realClock
): Promise<PageViewportSize> {
  const deadline = clock.now() + VIEWPORT_RESET_SETTLE_MS
  let size = await read()
  for (;;) {
    const expected = viewSize()
    if (!expected || (Math.abs(size.width - expected.width) <= 1 && Math.abs(size.height - expected.height) <= 1)) return size
    if (clock.now() >= deadline) return size
    await clock.wait(VIEWPORT_RESET_POLL_MS)
    size = await read()
  }
}

/**
 * How long opening an address or waking a tab waits for its page to finish loading. A page whose load never ends, such
 * as one with an image its server never answers, keeps loading in its tab, as in Chrome, while the caller goes on.
 */
export const PAGE_LOAD_WAIT_MS = 30_000

/** Whether the load settled within the wait. Its failure comes through; a load still running is left to run. */
export async function settledWithin(load: Promise<unknown>, waitMs = PAGE_LOAD_WAIT_MS): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const waited = new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), waitMs) })
  try {
    return await Promise.race([load.then(() => true), waited])
  } finally {
    clearTimeout(timer)
  }
}

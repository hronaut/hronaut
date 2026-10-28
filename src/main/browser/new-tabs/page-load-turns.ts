/**
 * Starting a page's load costs the main process a few milliseconds. Tabs opened together, such as dozens an agent opens
 * at once, all wait for the same session's cookies and would start every load in the same task once they are back,
 * keeping the window and every IPC call waiting meanwhile. Each start takes its own turn of the event loop instead, in
 * the order the tabs were opened.
 */
let lastTurn: Promise<void> = Promise.resolve()

/** Resolves on this caller's own turn of the event loop, after the turn of every caller before it. */
export function nextPageLoadTurn(): Promise<void> {
  const turn = lastTurn.then(() => new Promise<void>((resolve) => setImmediate(resolve)))
  lastTurn = turn
  return turn
}

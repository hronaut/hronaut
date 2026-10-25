/** The tab fields the status bubble reads: its id. */
export interface PageTargetUrlEventsTab {
  id: string
}

/** The tab manager options the page's links and the person's pointer over it report to. */
export interface PageTargetUrlEventsOptions {
  /** The link under the person's pointer or with keyboard focus changed; an empty address means none. */
  onPageTargetUrl?: (tabId: string, url: string) => void
  /** The person's pointer moved over the page, to this point in its own coordinates, or left it: null. */
  onPagePointer?: (tabId: string, pointer: { x: number; y: number } | null) => void
}

/**
 * What following a page's links for the status bubble needs from the tab
 * manager, which keeps in-flight agent input, agent tool calls and its options
 * private.
 */
export interface PageTargetUrlEventsAccess {
  /** How many agent input operations are in flight for each page, by WebContents id. */
  agentInputWebContents(): ReadonlyMap<number, number>
  /** Whether an agent's tool call on the tab is in flight, such as a script it runs there that focuses a link. */
  agentToolCallInFlight(tabId: string): boolean
  /** The tab manager's options. */
  options(): PageTargetUrlEventsOptions
}

/** As in Chrome, a website whose permission prompt was closed this many times without an answer is no longer asked. */
const DISMISSALS_BEFORE_EMBARGO = 3
/** How long Chrome refuses such a website without asking. */
const DISMISSAL_EMBARGO_MS = 7 * 24 * 60 * 60 * 1_000
/** The websites and permissions kept at most, the least recently closed forgotten first. */
const MAX_DISMISSALS = 1_000

/** A website's request for a permission, as the decision it would get belongs to it. */
export interface DismissedRequest {
  workspaceId: string
  origin: string
  permission: string
  /** The website of the page it is embedded in, when another website's. */
  embeddedIn?: string
}

/**
 * The permission prompts the person closed with Escape or a close button instead of answering, by workspace, website and
 * permission, while Hronaut runs. A closed prompt keeps no decision, so the website may ask again, but as in Chrome, once
 * its prompt was closed three times it is refused without asking for a week. A decision saved for it, as in Site
 * controls or Settings, comes first and ends that. The week goes by the clock, as in Chrome, which keeps counting while
 * the computer sleeps; a clock set back before it began ends it rather than lengthening it.
 */
export function createPermissionDismissals(now: () => number = Date.now) {
  const dismissals = new Map<string, { count: number, embargoed?: { from: number, until: number } }>()
  const keyOf = ({ workspaceId, origin, permission, embeddedIn }: DismissedRequest): string => (
    [workspaceId, origin, permission, embeddedIn ?? ''].join('\u0000')
  )

  return {
    /** Whether the website is refused without asking, after its prompt was closed three times. */
    embargoed(request: DismissedRequest): boolean {
      const key = keyOf(request)
      const embargoed = dismissals.get(key)?.embargoed
      if (!embargoed) return false
      const time = now()
      if (time >= embargoed.from && time < embargoed.until) return true
      dismissals.delete(key)
      return false
    },
    /** Notes that the person closed the website's prompt without an answer. */
    dismissed(request: DismissedRequest): void {
      const key = keyOf(request)
      const record = dismissals.get(key) ?? { count: 0 }
      dismissals.delete(key)
      record.count += 1
      if (record.count >= DISMISSALS_BEFORE_EMBARGO) {
        const time = now()
        record.embargoed = { from: time, until: time + DISMISSAL_EMBARGO_MS }
      }
      dismissals.set(key, record)
      if (dismissals.size > MAX_DISMISSALS) dismissals.delete(dismissals.keys().next().value!)
    },
    /** Forgets the closed prompts once the person answers one, which counts from none again. */
    answered(request: DismissedRequest): void {
      dismissals.delete(keyOf(request))
    },
    /** Forgets the closed prompts of every request a saved decision now answers, as the person's choice ends them. */
    forgetDecided(decisions: Iterable<DismissedRequest>): void {
      if (dismissals.size === 0) return
      for (const decision of decisions) dismissals.delete(keyOf(decision))
    },
    /** Forgets the closed prompts of a workspace the person closed or deleted. */
    forgetWorkspace(workspaceId: string): void {
      for (const key of dismissals.keys()) {
        if (key.startsWith(`${workspaceId}\u0000`)) dismissals.delete(key)
      }
    }
  }
}

export type PermissionDismissals = ReturnType<typeof createPermissionDismissals>

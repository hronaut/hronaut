import { createHmac, randomBytes } from 'node:crypto'

// Long enough to sign up with a suggested password; a page that keeps it longer is offered it as any other password.
const REMEMBERED_FOR_MS = 60 * 60_000
const MOST_REMEMBERED = 20

/**
 * The passwords Hronaut suggested in the last hour, at most the latest 20, so the offer to save a password a page
 * submits can say that Hronaut made it. Only a digest of each website and password is kept, in memory, never on
 * disk, keyed with a secret of this memory's own, so that even a short password cannot be found from it.
 */
export function createSuggestedPasswordMemory(now: () => number = Date.now): {
  remember(origin: string, password: string): void
  suggested(origin: string, password: string): boolean
} {
  const remembered: { digest: string; at: number }[] = []
  const key = randomBytes(32)
  const digest = (origin: string, password: string): string =>
    createHmac('sha256', key).update(origin).update('\n').update(password).digest('hex')
  const forgetExpired = (): void => {
    const oldest = now() - REMEMBERED_FOR_MS
    while (remembered.length && remembered[0]!.at <= oldest) remembered.shift()
  }
  return {
    remember(origin, password) {
      forgetExpired()
      remembered.push({ digest: digest(origin, password), at: now() })
      if (remembered.length > MOST_REMEMBERED) remembered.shift()
    },
    suggested(origin, password) {
      forgetExpired()
      const submitted = digest(origin, password)
      return remembered.some((entry) => entry.digest === submitted)
    }
  }
}

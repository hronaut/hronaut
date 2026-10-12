export interface StorageInspectionHooks {
  validate(): void
  readStarted(): void
  retainPublication(validate: () => void): void
}

export const storageInspectionFailure = () => ({
  status: 'STALE_OBSERVATION',
  effects: 'none',
  retrySafe: false,
  nextAction: 'Storage observation was withheld. Obtain fresh page and control state before deciding what to inspect next.'
})

// A revoked read cannot become current again, including while handling a native
// command failure. Keep the first veto sticky across quota fallback/publication.
export function storageInspectionGuard(validate: () => void): () => void {
  let rejected = false
  return () => {
    if (!rejected) {
      try { validate(); return } catch { rejected = true }
    }
    throw new Error(storageInspectionFailure().nextAction)
  }
}

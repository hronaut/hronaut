export interface CookieWriteProgress {
  attemptedWrites: number
  acknowledgedWrites: number
}

export interface CookieWriteHooks {
  validate(): void
  progress(progress: CookieWriteProgress): void
  retainPublication(validate: () => void): void
}

export function cookieWriteFailure(progress: CookieWriteProgress) {
  const attempted = progress.attemptedWrites > 0
  return {
    status: attempted ? 'OUTCOME_UNKNOWN' : 'NOT_DISPATCHED',
    effects: attempted ? 'possible' : 'none',
    ...progress,
    retrySafe: false,
    nextAction: attempted
      ? 'Cookie writes may have taken effect. Inspect current storage before deciding what to do next; do not automatically repeat the operation.'
      : 'No cookie write was submitted. Obtain fresh page and control state before deciding what to do next.'
  }
}

export function createCookieWriteOperation(validate: () => void, publish: (progress: CookieWriteProgress) => void = () => {}) {
  const progress: CookieWriteProgress = { attemptedWrites: 0, acknowledgedWrites: 0 }
  return {
    async write(operation: () => Promise<void>): Promise<void> {
      validate()
      progress.attemptedWrites++
      publish({ ...progress })
      try {
        await operation()
      } catch {
        throw new Error(cookieWriteFailure(progress).nextAction)
      }
      progress.acknowledgedWrites++
      publish({ ...progress })
      validate()
    }
  }
}

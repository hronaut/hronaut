export interface WebStorageProgress {
  mutation: boolean
  executionSubmitted: boolean
  executionAcknowledged: boolean
}

export interface WebStorageHooks {
  validate(): void
  progress(progress: WebStorageProgress): void
  retainPublication(validate: () => void): void
}

export function webStorageFailure(progress: WebStorageProgress) {
  const possibleMutation = progress.mutation && progress.executionSubmitted
  return {
    status: possibleMutation ? 'OUTCOME_UNKNOWN' : progress.executionSubmitted ? 'STALE_OBSERVATION' : 'NOT_DISPATCHED',
    effects: possibleMutation ? 'possible' : 'none',
    ...progress,
    retrySafe: false,
    nextAction: possibleMutation
      ? 'Storage changes may have taken effect. Inspect current storage before deciding what to do next; do not automatically repeat the operation.'
      : 'Storage data was withheld. Obtain fresh page and control state before deciding what to do next.'
  }
}

// Submission and acknowledgement describe JavaScript execution, not a count or
// proof of storage mutations. Even rejected execution may already have effects.
export async function executeWebStorage<T>(mutation: boolean, validate: () => void, execute: () => Promise<T>, publish: (progress: WebStorageProgress) => void = () => {}): Promise<T> {
  const progress: WebStorageProgress = { mutation, executionSubmitted: false, executionAcknowledged: false }
  validate()
  progress.executionSubmitted = true
  publish({ ...progress })
  let result: T
  try {
    result = await execute()
  } catch {
    throw new Error(webStorageFailure(progress).nextAction)
  }
  progress.executionAcknowledged = true
  publish({ ...progress })
  validate()
  return result
}

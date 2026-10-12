export const STORAGE_COMPARISON_INPUT_ERRORS = {
  UNSUPPORTED_SCHEME: 'Storage changes are available only for HTTP and HTTPS tabs.',
  BASELINE_REQUIRED: 'Set a storage baseline before comparing changes.'
} as const

export class StorageComparisonInputError extends Error {
  constructor(readonly reason: keyof typeof STORAGE_COMPARISON_INPUT_ERRORS) {
    super(STORAGE_COMPARISON_INPUT_ERRORS[reason])
    this.name = 'StorageComparisonInputError'
  }
}

export interface StorageComparisonHooks {
  validate(): void
  started(): void
  comparisonChanged(): void
  retainPublication(guard: { validate(): void; dispose(): void }): void
}

export const storageComparisonFailure = (comparisonStateChanged: boolean) => ({
  status: comparisonStateChanged ? 'OUTCOME_UNKNOWN' : 'STALE_OBSERVATION',
  effects: comparisonStateChanged ? 'possible' : 'none',
  comparisonStateChanged,
  siteStorageWriteSubmitted: false,
  retrySafe: false,
  nextAction: comparisonStateChanged
    ? 'Storage comparison output was withheld. Retained comparison state was changed and is not rolled back. Inspect current state and authority before proceeding; do not automatically replay.'
    : 'Storage comparison output was withheld. This operation did not change retained comparison state. Obtain fresh state and authority before proceeding; do not automatically replay.'
})

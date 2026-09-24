export interface BrowserNativeSelectionSession<Result> {
  canceled: boolean
  inputQueue: Promise<void>
  settled: boolean
  result: Promise<Result>
  resolve: (result: Result) => void
  reject: (error: unknown) => void
}

export function createNativeSelectionSession<Result>(): BrowserNativeSelectionSession<Result> {
  let resolvePromise!: (result: Result) => void
  let rejectPromise!: (error: unknown) => void
  const result = new Promise<Result>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  const session: BrowserNativeSelectionSession<Result> = {
    canceled: false,
    inputQueue: Promise.resolve(),
    settled: false,
    result,
    resolve: () => undefined,
    reject: () => undefined
  }
  session.resolve = (value) => {
    if (session.settled) return
    session.settled = true
    resolvePromise(value)
  }
  session.reject = (error) => {
    if (session.settled) return
    session.settled = true
    rejectPromise(error)
  }
  return session
}

export function createElementPickerSession<Result>(): BrowserNativeSelectionSession<Result> & { pointerDown: boolean } {
  // Resolve and reject close over this object; copying it would leave settled stale.
  return Object.assign(createNativeSelectionSession<Result>(), { pointerDown: false })
}

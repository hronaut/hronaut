import type { PostconditionReadResult } from './post-write-browser-read.js'
import { PostWriteVerification, type VerificationContract, type VerificationEvent } from './post-write-verification.js'

export interface PostWriteVerificationRunnerOptions {
  contract: VerificationContract
  read: (signal?: AbortSignal) => Promise<PostconditionReadResult>
  signal?: AbortSignal
  onEvent: (event: VerificationEvent) => Promise<void>
  now?: () => number
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>
}

async function cancellableSleep(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (delayMs <= 0 || signal?.aborted) return
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  await new Promise<void>(resolve => {
    timer = setTimeout(resolve, delayMs)
    if (signal) {
      onAbort = () => resolve()
      signal.addEventListener('abort', onAbort, { once: true })
    }
  })
  if (timer !== undefined) clearTimeout(timer)
  if (onAbort) signal?.removeEventListener('abort', onAbort)
}

/** Runs only bounded reads. It has no mutation callback and emits every new,
 * privacy-safe lifecycle event to the durable owner before continuing.
 */
export async function runPostWriteVerification(options: PostWriteVerificationRunnerOptions): Promise<VerificationEvent[]> {
  const model = new PostWriteVerification(options.contract, options.now)
  const sleep = options.sleep ?? cancellableSleep
  let persisted = 1 // Admission owns the initial pending event.
  const flush = async (): Promise<void> => {
    const events = model.timeline()
    for (const event of events.slice(persisted)) await options.onEvent(event)
    persisted = events.length
  }
  while (true) {
    if (options.signal?.aborted) model.cancel()
    const delay = model.nextDelayMs(options.contract.contextFingerprint)
    await flush()
    if (delay === null) break
    if (delay > 0) {
      await sleep(delay, options.signal)
      continue
    }
    const attemptId = model.beginRead(options.contract.contextFingerprint)
    await flush()
    if (!attemptId) continue
    const evidence = await options.read(options.signal)
    if (options.signal?.aborted) model.cancel()
    else model.finishRead(attemptId, evidence, options.contract.contextFingerprint)
    await flush()
  }
  return model.timeline()
}

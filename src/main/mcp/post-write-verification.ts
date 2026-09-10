import { randomUUID } from 'node:crypto'
import { z } from 'zod'

const evidenceSchema = z.enum(['matches', 'not-yet-visible', 'context-changed', 'unavailable'])

const contractSchema = z.object({
  actionId: z.uuid(),
  transport: z.enum(['succeeded', 'ambiguous', 'failed']),
  // Main-owned evidence binding: workspace, tab, origin, account and predicate.
  // This fingerprint is never included in public verification events.
  contextFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  timeoutMs: z.number().int().min(1).max(600_000),
  maxAttempts: z.number().int().min(1).max(20),
  initialDelayMs: z.number().int().min(1).max(30_000)
}).strict()

export type VerificationContract = z.infer<typeof contractSchema>
export type VerificationState = 'pending' | 'not-yet-visible' | 'verified' | 'unknown'
export type VerificationReason = 'awaiting-read' | 'postcondition-matched' | 'postcondition-not-visible' | 'read-unavailable' | 'transport-ambiguous' | 'transport-failed' | 'deadline' | 'attempt-limit' | 'context-changed' | 'clock-invalid' | 'cancelled' | 'restart'
export interface VerificationEvent {
  actionId: string
  sequence: number
  attempt: number
  state: VerificationState
  reason: VerificationReason
}

/** Verification lifecycle only. It has no mutation or read callbacks. Runtime
 * adapters must authorize and persist admission before performing a bounded
 * read, then submit evidence against the same private context binding.
 */
export class PostWriteVerification {
  private readonly contract: VerificationContract
  private readonly deadline: number
  private previousTime: number
  private nextReadAt: number
  private activeAttempt: string | undefined
  private attempts = 0
  private state: VerificationState = 'pending'
  private readonly events: VerificationEvent[] = []

  constructor(contract: VerificationContract, private readonly now: () => number = () => performance.now()) {
    this.contract = contractSchema.parse(contract)
    const time = now()
    if (!Number.isFinite(time) || !Number.isFinite(time + this.contract.timeoutMs)) throw new Error('Verification clock unavailable')
    this.previousTime = time
    this.nextReadAt = time
    this.deadline = time + this.contract.timeoutMs
    this.record('pending', 'awaiting-read')
    if (this.contract.transport !== 'succeeded') this.record('unknown', this.contract.transport === 'ambiguous' ? 'transport-ambiguous' : 'transport-failed')
  }

  private terminal(): boolean { return this.state === 'verified' || this.state === 'unknown' }

  private record(state: VerificationState, reason: VerificationReason): void {
    this.state = state
    this.events.push({ actionId: this.contract.actionId, sequence: this.events.length + 1, attempt: this.attempts, state, reason })
  }

  private check(contextFingerprint: string): number {
    const time = this.now()
    if (this.terminal()) return time
    if (!Number.isFinite(time) || time < this.previousTime) this.record('unknown', 'clock-invalid')
    else if (time >= this.deadline) this.record('unknown', 'deadline')
    else if (contextFingerprint !== this.contract.contextFingerprint) this.record('unknown', 'context-changed')
    this.previousTime = time
    return time
  }

  beginRead(contextFingerprint: string): string | null {
    const time = this.check(contextFingerprint)
    if (this.terminal() || time < this.nextReadAt) return null
    if (this.activeAttempt) throw new Error('Verification read already pending')
    if (this.attempts >= this.contract.maxAttempts) { this.record('unknown', 'attempt-limit'); return null }
    this.attempts += 1
    this.activeAttempt = randomUUID()
    return this.activeAttempt
  }

  finishRead(attemptId: string, evidence: 'matches' | 'not-yet-visible' | 'context-changed' | 'unavailable', contextFingerprint: string): void {
    evidenceSchema.parse(evidence)
    const time = this.check(contextFingerprint)
    if (this.terminal()) return
    if (!this.activeAttempt || attemptId !== this.activeAttempt) throw new Error('Verification attempt unavailable')
    this.activeAttempt = undefined
    if (evidence === 'matches') this.record('verified', 'postcondition-matched')
    else if (evidence === 'context-changed') this.record('unknown', 'context-changed')
    else if (evidence === 'unavailable') this.record('unknown', 'read-unavailable')
    else {
      this.record('not-yet-visible', 'postcondition-not-visible')
      if (this.attempts >= this.contract.maxAttempts) this.record('unknown', 'attempt-limit')
      else this.nextReadAt = time + Math.min(30_000, this.contract.initialDelayMs * 2 ** (this.attempts - 1))
    }
  }

  cancel(): void { if (!this.terminal()) this.record('unknown', 'cancelled') }

  nextDelayMs(contextFingerprint: string): number | null {
    const time = this.check(contextFingerprint)
    if (this.terminal()) return null
    return Math.max(0, Math.min(this.nextReadAt, this.deadline) - time)
  }

  timeline(): VerificationEvent[] {
    this.check(this.contract.contextFingerprint)
    return structuredClone(this.events)
  }
}

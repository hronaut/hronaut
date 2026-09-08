import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { CommercialLicenseProviderResult, CommercialLicenseState } from '../shared/types.js'
import { writeTextFileAtomically } from './atomic-file.js'

interface PersistedCommercialLicense {
  version: 1
  installationId: string
  trialStartedAt?: string
  lastSeenAt?: string
  trialInvalid?: boolean
  encryptedLicenseKey?: string
  keySuffix?: string
  instanceId?: string
  status?: string
  activations?: number
  activationLimit?: number | null
  expiresAt?: string | null
  lastValidatedAt?: string
}

export interface CommercialLicenseEncryption {
  encrypt(value: string): Promise<Buffer>
  decrypt(value: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

export const TRIAL_DURATION_MS = 10 * 24 * 60 * 60 * 1000
export const LICENSE_OFFLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1000

function licenseGrantIsActive(status: string | undefined, expiresAt: string | null | undefined, now: number): boolean {
  if (status !== 'active') return false
  if (expiresAt == null) return true
  const expiration = Date.parse(expiresAt)
  return Number.isFinite(expiration) && expiration > now
}

function parsedState(value: unknown): PersistedCommercialLicense | null {
  if (!value || typeof value !== 'object') return null
  const entry = value as Partial<PersistedCommercialLicense>
  if (entry.version !== 1 || typeof entry.installationId !== 'string' || entry.installationId.length < 16) return null
  if (entry.encryptedLicenseKey !== undefined && (typeof entry.encryptedLicenseKey !== 'string' || !entry.encryptedLicenseKey)) return null
  if (entry.instanceId !== undefined && (typeof entry.instanceId !== 'string' || !entry.instanceId)) return null
  if (entry.trialStartedAt !== undefined && !validDate(entry.trialStartedAt)) return null
  if (entry.lastSeenAt !== undefined && !validDate(entry.lastSeenAt)) return null
  if (entry.lastValidatedAt !== undefined && !validDate(entry.lastValidatedAt)) return null
  return { ...entry, version: 1, installationId: entry.installationId }
}

export class CommercialLicenseStore {
  private value: PersistedCommercialLicense = { version: 1, installationId: randomUUID() }
  private mutationQueue: Promise<void> = Promise.resolve()
  private saveQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly path: string,
    private readonly encryption: CommercialLicenseEncryption
  ) {}

  async load(): Promise<void> {
    try {
      const parsed = parsedState(JSON.parse(await readFile(this.path, 'utf8')))
      if (parsed) {
        this.value = parsed
        return
      }
      this.value.trialInvalid = true
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
      if (error instanceof SyntaxError) this.value.trialInvalid = true
    }
    await this.persist()
  }

  installationName(): string {
    return `Hronaut ${this.value.installationId.replaceAll('-', '').slice(0, 12)}`
  }

  hasActivation(): boolean {
    return Boolean(this.value.encryptedLicenseKey && this.value.instanceId)
  }

  async credentials(): Promise<{ licenseKey: string; instanceId: string } | null> {
    const encryptedLicenseKey = this.value.encryptedLicenseKey
    const instanceId = this.value.instanceId
    if (!encryptedLicenseKey || !instanceId) return null
    const decrypted = await this.encryption.decrypt(Buffer.from(encryptedLicenseKey, 'base64'))
    if (decrypted.shouldReEncrypt) {
      await this.queueMutation(async () => {
        if (this.value.encryptedLicenseKey !== encryptedLicenseKey) return
        const nextValue = {
          ...this.value,
          encryptedLicenseKey: (await this.encryption.encrypt(decrypted.result)).toString('base64')
        }
        await this.persist(nextValue)
        this.value = nextValue
      })
    }
    return { licenseKey: decrypted.result, instanceId }
  }

  async saveActivation(licenseKey: string, result: CommercialLicenseProviderResult): Promise<void> {
    if (!result.instanceId) throw new Error('License activation did not return an instance ID')
    await this.queueMutation(async () => {
      const nextValue = {
        ...this.value,
        encryptedLicenseKey: (await this.encryption.encrypt(licenseKey)).toString('base64'),
        keySuffix: licenseKey.replaceAll('-', '').slice(-4).toUpperCase(),
        instanceId: result.instanceId,
        status: result.status,
        activations: result.activations,
        activationLimit: result.activationLimit,
        expiresAt: result.expiresAt,
        lastValidatedAt: new Date().toISOString()
      }
      await this.persist(nextValue)
      this.value = nextValue
    })
  }

  async saveValidation(result: CommercialLicenseProviderResult): Promise<void> {
    await this.queueMutation(async () => {
      const nextValue = {
        ...this.value,
        status: result.valid ? result.status : 'inactive',
        activations: result.activations,
        activationLimit: result.activationLimit,
        expiresAt: result.expiresAt,
        lastValidatedAt: new Date().toISOString()
      }
      await this.persist(nextValue)
      this.value = nextValue
    })
  }

  async markInactive(): Promise<void> {
    await this.queueMutation(async () => {
      const nextValue = {
        ...this.value,
        status: 'inactive',
        lastValidatedAt: new Date().toISOString()
      }
      await this.persist(nextValue)
      this.value = nextValue
    })
  }

  async clear(): Promise<void> {
    await this.queueMutation(async () => {
      const nextValue = {
        version: 1 as const, installationId: this.value.installationId,
        trialStartedAt: this.value.trialStartedAt, lastSeenAt: this.value.lastSeenAt,
        trialInvalid: this.value.trialInvalid
      }
      await this.persist(nextValue)
      this.value = nextValue
    })
  }

  summary(secureStorageAvailable: boolean, message?: string): CommercialLicenseState {
    const hasActivation = this.hasActivation()
    const now = Math.max(Date.now(), Date.parse(this.value.lastSeenAt ?? '') || 0)
    const validatedAt = Date.parse(this.value.lastValidatedAt ?? '')
    const active = hasActivation && licenseGrantIsActive(this.value.status, this.value.expiresAt, now)
      && Number.isFinite(validatedAt) && now >= validatedAt && now - validatedAt < LICENSE_OFFLINE_GRACE_MS
    const startedAt = Date.parse(this.value.trialStartedAt ?? '')
    const trialExpiresAt = Number.isFinite(startedAt) ? new Date(startedAt + TRIAL_DURATION_MS).toISOString() : undefined
    const trialActive = !this.value.trialInvalid && Number.isFinite(startedAt)
      && now >= startedAt && now < startedAt + TRIAL_DURATION_MS
    const status = this.value.status === 'active' && !active && hasActivation ? 'expired' : this.value.status
    return {
      status: hasActivation ? (status ?? 'validation-required') : 'not-activated',
      active,
      accessAllowed: active || trialActive,
      trialStatus: this.value.trialInvalid ? 'expired' : !trialExpiresAt ? 'not-started' : trialActive ? 'active' : 'expired',
      trialExpiresAt,
      secureStorageAvailable,
      maskedKey: this.value.keySuffix ? `••••-${this.value.keySuffix}` : undefined,
      activations: this.value.activations,
      activationLimit: this.value.activationLimit,
      expiresAt: this.value.expiresAt,
      lastValidatedAt: this.value.lastValidatedAt,
      message
    }
  }

  async authorizeAutomation(): Promise<void> {
    await this.queueMutation(async () => {
      const now = Math.max(Date.now(), Date.parse(this.value.lastSeenAt ?? '') || 0)
      const nextValue = { ...this.value, lastSeenAt: new Date(now).toISOString() }
      if (!nextValue.trialStartedAt && !nextValue.trialInvalid && !this.hasActivation()) {
        nextValue.trialStartedAt = new Date(now).toISOString()
      }
      await this.persist(nextValue)
      this.value = nextValue
    })
    if (!this.summary(true).accessAllowed) {
      throw new Error('Hronaut requires an active subscription after the 10-day trial. Open Settings → License to activate or renew. $4/month or $24/year (50% off). Saved browser data remains accessible.')
    }
  }

  flush(): Promise<void> {
    return this.mutationQueue
  }

  private queueMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const operation = this.mutationQueue.then(mutation)
    this.mutationQueue = operation.then(() => undefined, () => undefined)
    return operation
  }

  private persist(value: PersistedCommercialLicense = this.value): Promise<void> {
    const snapshot = { ...value }
    const operation = this.saveQueue.then(async () => {
      await writeTextFileAtomically(this.path, `${JSON.stringify(snapshot, null, 2)}\n`)
    })
    this.saveQueue = operation.catch(() => undefined)
    return operation
  }
}

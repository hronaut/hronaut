import { app, safeStorage } from 'electron'
import { join } from 'node:path'
import { CommercialLicenseClient, CommercialLicenseError } from './commercial-license-client.js'
import { COMMERCIAL_LICENSE_API_BASE_URL } from './commercial-license-links.js'
import { CommercialLicenseOperationCoordinator } from './commercial-license-operations.js'
import { CommercialLicenseStore, commercialLicenseStateRefreshDelay } from './commercial-license-store.js'
import type { MessageKey, MessageParameters } from '../shared/i18n.js'
import type { CommercialLicenseState, CredentialStorageStatus } from '../shared/types.js'

const COMMERCIAL_LICENSE_API_BASE = process.env.HRONAUT_LICENSE_API_BASE || COMMERCIAL_LICENSE_API_BASE_URL

interface CommercialLicenseRuntimeHost {
  /** Translates into the current interface language; read on every use because the language can change. */
  text(key: MessageKey, parameters?: MessageParameters): string
  /** Whether secure storage is available, and why not; read on every use because it is known only after startup. */
  credentialStorageStatus(): CredentialStorageStatus
  /** Whether the app is quitting, when the state stops refreshing itself. */
  quitting(): boolean
  sendToShellWindows(channel: string, ...args: unknown[]): void
  /** The license store, once it is open; the wallet broker, the MCP server and shutdown read it too. */
  commercialLicenseStore(): CommercialLicenseStore | null
  setCommercialLicenseStore(store: CommercialLicenseStore): void
  /** The timer that publishes the state again when it next changes by itself; before-quit clears it. */
  commercialLicenseStateTimer(): ReturnType<typeof setTimeout> | undefined
  setCommercialLicenseStateTimer(timer: ReturnType<typeof setTimeout>): void
}

/**
 * The commercial license on this device: opening its encrypted store, its state for the shell, and activating,
 * refreshing and removing it through the license service. Mutations run one at a time, and a refresh that a
 * mutation overtook leaves the state alone.
 */
export function createCommercialLicenseRuntime(host: CommercialLicenseRuntimeHost): {
  configureCommercialLicenseStore(): Promise<void>
  currentCommercialLicenseState(): CommercialLicenseState
  publishCommercialLicenseState(): CommercialLicenseState
  activateCommercialLicense(value: unknown): Promise<CommercialLicenseState>
  refreshCommercialLicense(): Promise<CommercialLicenseState>
  deactivateCommercialLicense(): Promise<CommercialLicenseState>
} {
  let commercialLicenseClient: CommercialLicenseClient | null = null
  let commercialLicenseMessage: string | undefined
  const commercialLicenseOperations = new CommercialLicenseOperationCoordinator()

  async function configureCommercialLicenseStore(): Promise<void> {
    commercialLicenseClient = new CommercialLicenseClient(COMMERCIAL_LICENSE_API_BASE)
    host.setCommercialLicenseStore(new CommercialLicenseStore(join(app.getPath('userData'), 'commercial-license.json'), {
      encrypt: (value) => safeStorage.encryptStringAsync(value),
      decrypt: (value) => safeStorage.decryptStringAsync(value)
    }))
    await host.commercialLicenseStore()!.load()
  }

  function currentCommercialLicenseState(): CommercialLicenseState {
    if (!host.commercialLicenseStore()) {
      return {
        status: 'not-activated',
        active: false,
        secureStorageAvailable: false,
        message: host.credentialStorageStatus().reason || host.text('native.errors.secureStorage')
      }
    }
    return host.commercialLicenseStore()!.summary(host.credentialStorageStatus().available, commercialLicenseMessage)
  }

  function publishCommercialLicenseState(): CommercialLicenseState {
    const state = currentCommercialLicenseState()
    host.sendToShellWindows('license:changed', state)
    clearTimeout(host.commercialLicenseStateTimer())
    if (!host.quitting()) host.setCommercialLicenseStateTimer(setTimeout(publishCommercialLicenseState, commercialLicenseStateRefreshDelay(state)).unref())
    return state
  }

  function commercialLicenseFriendlyMessage(reason: string): string {
    const messages: Record<string, string> = {
      activation_limit_reached: host.text('native.errors.activationLimit'),
      commercial_inactive: host.text('native.errors.subscriptionInactive'),
      entitlement_pending: host.text('native.errors.entitlementPending'),
      instance_conflict: host.text('native.errors.instanceConflict'),
      license_inactive: host.text('native.errors.licenseInactive'),
      license_not_found: host.text('native.errors.licenseNotFound'),
      invalid_license: host.text('native.errors.invalidLicense'),
      invalid_license_key: host.text('native.errors.invalidLicenseKey'),
      provider_unavailable: host.text('native.errors.providerUnavailable'),
      provider_invalid_response: host.text('native.errors.providerInvalid'),
      service_unavailable: host.text('native.errors.providerUnavailable'),
      wrong_product: host.text('native.errors.wrongProduct')
    }
    return messages[reason] ?? host.text('native.errors.invalidLicense')
  }

  async function activateCommercialLicenseNow(value: unknown): Promise<CommercialLicenseState> {
    if (typeof value !== 'string') throw new TypeError('Commercial license key must be a string')
    const licenseKey = value.trim().toUpperCase()
    if (!/^[A-Z0-9][A-Z0-9-]{15,127}$/.test(licenseKey)) throw new TypeError('Enter the complete commercial license key from your Creem receipt')
    if (!host.credentialStorageStatus().available || !host.commercialLicenseStore() || !commercialLicenseClient) throw new Error('Secure license storage is unavailable')
    try {
      const result = await commercialLicenseClient.activate(licenseKey, host.commercialLicenseStore()!.installationName())
      if (!result.valid || result.status !== 'active') throw new CommercialLicenseError('license_inactive')
      await host.commercialLicenseStore()!.saveActivation(licenseKey, result)
      commercialLicenseMessage = 'Commercial license activated for this device.'
      return publishCommercialLicenseState()
    } catch (error) {
      const reason = error instanceof CommercialLicenseError ? error.reason : 'service_unavailable'
      commercialLicenseMessage = commercialLicenseFriendlyMessage(reason)
      publishCommercialLicenseState()
      throw new Error(commercialLicenseMessage)
    }
  }

  function activateCommercialLicense(value: unknown): Promise<CommercialLicenseState> {
    return commercialLicenseOperations.mutate(() => activateCommercialLicenseNow(value))
  }

  function refreshCommercialLicense(): Promise<CommercialLicenseState> {
    return commercialLicenseOperations.refresh(async (isCurrent) => {
      if (!host.commercialLicenseStore() || !commercialLicenseClient) return currentCommercialLicenseState()
      const credentials = await host.commercialLicenseStore()!.credentials()
      if (!credentials || !isCurrent()) return currentCommercialLicenseState()
      try {
        const result = await commercialLicenseClient.validate(credentials.licenseKey, credentials.instanceId)
        if (!isCurrent()) return currentCommercialLicenseState()
        await host.commercialLicenseStore()!.saveValidation(result)
        if (!isCurrent()) return currentCommercialLicenseState()
        commercialLicenseMessage = result.valid && result.status === 'active'
          ? 'Commercial license is active.'
          : commercialLicenseFriendlyMessage('license_inactive')
        return publishCommercialLicenseState()
      } catch (error) {
        if (!isCurrent()) return currentCommercialLicenseState()
        const reason = error instanceof CommercialLicenseError ? error.reason : 'service_unavailable'
        if (reason === 'commercial_inactive' || reason === 'license_inactive' || reason === 'license_not_found') {
          await host.commercialLicenseStore()!.markInactive()
          if (!isCurrent()) return currentCommercialLicenseState()
        }
        commercialLicenseMessage = reason === 'service_unavailable' || reason === 'provider_unavailable'
          ? 'Could not reach the commercial license service. The last successful validation remains stored on this device.'
          : commercialLicenseFriendlyMessage(reason)
        return publishCommercialLicenseState()
      }
    }, () => currentCommercialLicenseState())
  }

  async function deactivateCommercialLicenseNow(): Promise<CommercialLicenseState> {
    if (!host.commercialLicenseStore() || !commercialLicenseClient) return currentCommercialLicenseState()
    const credentials = await host.commercialLicenseStore()!.credentials()
    if (!credentials) return currentCommercialLicenseState()
    try {
      await commercialLicenseClient.deactivate(credentials.licenseKey, credentials.instanceId)
    } catch (error) {
      const reason = error instanceof CommercialLicenseError ? error.reason : 'service_unavailable'
      if (reason !== 'instance_conflict' && reason !== 'license_not_found') {
        commercialLicenseMessage = commercialLicenseFriendlyMessage(reason)
        publishCommercialLicenseState()
        throw new Error(commercialLicenseMessage)
      }
    }
    await host.commercialLicenseStore()!.clear()
    commercialLicenseMessage = 'Commercial license removed from this device.'
    return publishCommercialLicenseState()
  }

  function deactivateCommercialLicense(): Promise<CommercialLicenseState> {
    return commercialLicenseOperations.mutate(() => deactivateCommercialLicenseNow())
  }

  return {
    configureCommercialLicenseStore,
    currentCommercialLicenseState,
    publishCommercialLicenseState,
    activateCommercialLicense,
    refreshCommercialLicense,
    deactivateCommercialLicense
  }
}

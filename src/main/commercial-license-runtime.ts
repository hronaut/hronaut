import { app, safeStorage } from 'electron'
import { join } from 'node:path'
import { CommercialLicenseClient, CommercialLicenseError } from './commercial-license-client.js'
import { COMMERCIAL_LICENSE_API_BASE_URL } from './commercial-license-links.js'
import { CommercialLicenseOperationCoordinator } from './commercial-license-operations.js'
import { CommercialLicenseStore, commercialLicenseStateRefreshDelay } from './commercial-license-store.js'
import type { AppQuitState } from './app-lifecycle.js'
import { LocalizedError } from './localized-error.js'
import type { MessageKey, MessageParameters } from '../shared/i18n.js'
import type { CommercialLicenseState, CredentialStorageStatus } from '../shared/types.js'

const COMMERCIAL_LICENSE_API_BASE = process.env.HRONAUT_LICENSE_API_BASE || COMMERCIAL_LICENSE_API_BASE_URL

/**
 * The license store and the timer that publishes its state again, created once by index.ts and opened by startup. The
 * wallet broker, the MCP server, before-quit and shutdown read the fields when they run, so they always see the open
 * store and the pending timer.
 */
export interface CommercialLicenseRuntimeState {
  /** The encrypted license store, once open. */
  store: CommercialLicenseStore | null
  /** The timer that publishes the state again when it next changes by itself; before-quit clears it. */
  stateTimer: ReturnType<typeof setTimeout> | undefined
}

interface CommercialLicenseRuntimeHost {
  /** Translates into the current interface language; read on every use because the language can change. */
  text(key: MessageKey, parameters?: MessageParameters): string
  /** Whether secure storage is available, and why not; read on every use because it is known only after startup. */
  credentialStorageStatus(): CredentialStorageStatus
  /** Whether the app is quitting, when the state stops refreshing itself; read on every publish. */
  quit: AppQuitState
  sendToShellWindows(channel: string, ...args: unknown[]): void
  /** The license store and its state timer; index.ts creates the record, and other features read it too. */
  state: CommercialLicenseRuntimeState
}

/**
 * The commercial license on this device: opening its encrypted store, its state for the shell, activating,
 * refreshing and removing it through the license service, and admitting agents' automation under it. Mutations run
 * one at a time, and a refresh that a mutation overtook leaves the state alone.
 */
export function createCommercialLicenseRuntime(host: CommercialLicenseRuntimeHost): {
  configureCommercialLicenseStore(): Promise<void>
  currentCommercialLicenseState(): CommercialLicenseState
  activateCommercialLicense(value: unknown): Promise<CommercialLicenseState>
  refreshCommercialLicense(): Promise<CommercialLicenseState>
  deactivateCommercialLicense(): Promise<CommercialLicenseState>
  authorizeAutomation(): Promise<void>
  assertAutomationAccess(): void
  startBackgroundLicenseRefresh(): void
} {
  let commercialLicenseClient: CommercialLicenseClient | null = null
  let commercialLicenseMessage: string | undefined
  const commercialLicenseOperations = new CommercialLicenseOperationCoordinator()

  async function configureCommercialLicenseStore(): Promise<void> {
    commercialLicenseClient = new CommercialLicenseClient(COMMERCIAL_LICENSE_API_BASE)
    host.state.store = new CommercialLicenseStore(join(app.getPath('userData'), 'commercial-license.json'), {
      encrypt: (value) => safeStorage.encryptStringAsync(value),
      decrypt: (value) => safeStorage.decryptStringAsync(value)
    })
    await host.state.store!.load()
  }

  function currentCommercialLicenseState(): CommercialLicenseState {
    if (!host.state.store) {
      return {
        status: 'not-activated',
        active: false,
        secureStorageAvailable: false,
        message: host.credentialStorageStatus().reason || host.text('native.errors.secureStorage')
      }
    }
    return host.state.store!.summary(host.credentialStorageStatus().available, commercialLicenseMessage)
  }

  function publishCommercialLicenseState(): CommercialLicenseState {
    const state = currentCommercialLicenseState()
    host.sendToShellWindows('license:changed', state)
    clearTimeout(host.state.stateTimer)
    if (!host.quit.quitting) host.state.stateTimer = setTimeout(publishCommercialLicenseState, commercialLicenseStateRefreshDelay(state)).unref()
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
    if (!/^[A-Z0-9][A-Z0-9-]{15,127}$/.test(licenseKey)) throw new LocalizedError('native.errors.invalidLicenseKey', undefined, { message: 'Enter the complete commercial license key from your Creem receipt' })
    if (!host.credentialStorageStatus().available || !host.state.store || !commercialLicenseClient) throw new LocalizedError('appErrors.settings.licenseStorageUnavailable')
    try {
      const result = await commercialLicenseClient.activate(licenseKey, host.state.store!.installationName())
      if (!result.valid || result.status !== 'active') throw new CommercialLicenseError('license_inactive')
      await host.state.store!.saveActivation(licenseKey, result)
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
      if (!host.state.store || !commercialLicenseClient) return currentCommercialLicenseState()
      const credentials = await host.state.store!.credentials()
      if (!credentials || !isCurrent()) return currentCommercialLicenseState()
      try {
        const result = await commercialLicenseClient.validate(credentials.licenseKey, credentials.instanceId)
        if (!isCurrent()) return currentCommercialLicenseState()
        await host.state.store!.saveValidation(result)
        if (!isCurrent()) return currentCommercialLicenseState()
        commercialLicenseMessage = result.valid && result.status === 'active'
          ? 'Commercial license is active.'
          : commercialLicenseFriendlyMessage('license_inactive')
        return publishCommercialLicenseState()
      } catch (error) {
        if (!isCurrent()) return currentCommercialLicenseState()
        const reason = error instanceof CommercialLicenseError ? error.reason : 'service_unavailable'
        if (reason === 'commercial_inactive' || reason === 'license_inactive' || reason === 'license_not_found') {
          await host.state.store!.markInactive()
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
    if (!host.state.store || !commercialLicenseClient) return currentCommercialLicenseState()
    const credentials = await host.state.store!.credentials()
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
    await host.state.store!.clear()
    commercialLicenseMessage = 'Commercial license removed from this device.'
    return publishCommercialLicenseState()
  }

  function deactivateCommercialLicense(): Promise<CommercialLicenseState> {
    return commercialLicenseOperations.mutate(() => deactivateCommercialLicenseNow())
  }

  /** Admits an agent's automation under the license, which can change its state, so the state is published after. */
  async function authorizeAutomation(): Promise<void> {
    if (!host.state.store) throw new Error('License storage is unavailable')
    try {
      await host.state.store.authorizeAutomation()
    } finally {
      publishCommercialLicenseState()
    }
  }

  /** Refuses automation that the license does not allow, without changing its state. */
  function assertAutomationAccess(): void {
    if (!host.state.store) throw new Error('License storage is unavailable')
    host.state.store.assertAutomationAccess()
  }

  /**
   * Publishes the state once startup is done and refreshes an activated license in the background, first after 7.5
   * seconds and then every hour, while secure storage is available; neither timer keeps the app alive.
   */
  function startBackgroundLicenseRefresh(): void {
    const refreshLicense = (): void => {
      publishCommercialLicenseState()
      if (!host.state.store?.hasActivation() || !host.credentialStorageStatus().available) return
      void refreshCommercialLicense().catch((error: unknown) => {
        console.error('[license] Background refresh failed:', error)
      })
    }
    publishCommercialLicenseState()
    setTimeout(refreshLicense, 7_500).unref()
    setInterval(refreshLicense, 60 * 60 * 1000).unref()
  }

  return {
    configureCommercialLicenseStore,
    currentCommercialLicenseState,
    activateCommercialLicense,
    refreshCommercialLicense,
    deactivateCommercialLicense,
    authorizeAutomation,
    assertAutomationAccess,
    startBackgroundLicenseRefresh
  }
}

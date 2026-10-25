import type { App, ConfigureHostResolverOptions, IpcMain, IpcMainInvokeEvent } from 'electron'
import { LocalizedError } from './localized-error.js'
import {
  DEFAULT_SECURE_DNS_MODE,
  SECURE_DNS_TEMPLATE_MAX_LENGTH,
  isSecureDnsMode,
  isSecureDnsTemplate
} from '../shared/secure-dns.js'
import type { AppSettings } from '../shared/types.js'

type SecureDnsSettings = Pick<AppSettings, 'secureDnsMode' | 'secureDnsTemplate'>
type HostResolver = Pick<App, 'configureHostResolver'>

/** Chromium's host resolver options for the setting: the chosen provider, only in Secure mode. */
export function hostResolverOptions(settings: SecureDnsSettings): ConfigureHostResolverOptions {
  if (settings.secureDnsMode === 'secure') return { secureDnsMode: 'secure', secureDnsServers: [settings.secureDnsTemplate] }
  return { secureDnsMode: settings.secureDnsMode, secureDnsServers: [] }
}

/** Looks up website addresses as the setting says, from the next lookup on; Chromium's refusal is a LocalizedError. */
export function applySecureDns(app: HostResolver, settings: SecureDnsSettings): void {
  try {
    app.configureHostResolver(hostResolverOptions(settings))
  } catch (error) {
    throw new LocalizedError('appErrors.settings.secureDnsRejected', undefined, { cause: error })
  }
}

/**
 * Applies the saved setting at startup, once Electron is ready and before any page loads. A provider Chromium refuses
 * leaves Automatic, Chromium's own default, for this run.
 */
export function applySavedSecureDns(app: HostResolver, settings: SecureDnsSettings): void {
  try {
    applySecureDns(app, settings)
  } catch {
    console.warn('[secure-dns] The saved secure DNS provider was refused; Automatic is used until it is changed.')
    applySecureDns(app, { secureDnsMode: DEFAULT_SECURE_DNS_MODE, secureDnsTemplate: '' })
  }
}

interface SecureDnsIpcHost {
  assertTrustedSender(event: IpcMainInvokeEvent): void
  app: HostResolver
  /** The current settings; read on every use because each committed update replaces the object. */
  settings(): AppSettings
  updateSettings(
    updates: Partial<AppSettings>,
    applyRuntime?: (value: AppSettings) => void | Promise<void>
  ): Promise<AppSettings>
  publishSettings(): void
}

/**
 * The Secure DNS setting: main checks the mode and the provider's address, applies them to Chromium's host resolver
 * and saves them together, putting the previous setting back when either step fails.
 */
export function registerSecureDnsIpc(ipcMain: Pick<IpcMain, 'handle'>, host: SecureDnsIpcHost): void {
  ipcMain.handle('settings:set-secure-dns', async (event, mode: unknown, template: unknown) => {
    host.assertTrustedSender(event)
    if (!isSecureDnsMode(mode)) throw new TypeError('Unsupported secure DNS mode')
    if (typeof template !== 'string' || template.length > SECURE_DNS_TEMPLATE_MAX_LENGTH) {
      throw new TypeError('Secure DNS provider must be a string')
    }
    const secureDnsTemplate = template.trim()
    // Another mode keeps the chosen provider for later, and has none until one is chosen.
    if ((mode === 'secure' || secureDnsTemplate) && !isSecureDnsTemplate(secureDnsTemplate)) {
      throw new LocalizedError('appErrors.settings.secureDnsRejected')
    }
    await host.updateSettings(
      { secureDnsMode: mode, secureDnsTemplate },
      (next) => applySecureDns(host.app, next)
    )
    host.publishSettings()
    return { ...host.settings() }
  })
}

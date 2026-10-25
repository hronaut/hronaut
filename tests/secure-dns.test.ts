import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { SECURE_DNS_PROVIDERS, isSecureDnsTemplate, readSecureDns } from '../src/shared/secure-dns.js'
import type { AppSettings } from '../src/shared/types.js'

vi.mock('electron', () => ({ app: { getPath: () => '' }, nativeTheme: {} }))

const { applySavedSecureDns, hostResolverOptions, registerSecureDnsIpc } = await import('../src/main/secure-dns.js')
const { DEFAULT_SETTINGS } = await import('../src/main/settings-store.js')
const { commitRuntimeSetting } = await import('../src/main/runtime-setting-commit.js')

// Hronaut had no secure DNS setting: Chromium looked up addresses in its default Automatic mode, with no way to turn
// DNS over HTTPS off or to send every lookup to one provider. As in Chrome's Use secure DNS, main now applies the
// chosen mode to Chromium's host resolver before saving it.

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

const CLOUDFLARE = SECURE_DNS_PROVIDERS[0].template

function secureDnsIpc(saved: Partial<AppSettings> = {}) {
  const handlers = new Map<string, Handler>()
  const ipcMain = { handle: (channel: string, handler: Handler) => { handlers.set(channel, handler) } } as unknown as IpcMain
  let settings: AppSettings = { ...DEFAULT_SETTINGS, ...saved }
  let saveFails = false
  const app = { configureHostResolver: vi.fn() }
  const host = {
    assertTrustedSender: vi.fn(),
    app,
    settings: () => settings,
    // As settings-runtime does: the runtime change first, then the save, with the previous setting put back on failure.
    updateSettings: vi.fn(async (updates: Partial<AppSettings>, applyRuntime?: (value: AppSettings) => void | Promise<void>) => {
      const next = { ...settings, ...updates }
      await commitRuntimeSetting({
        previous: settings,
        next,
        apply: applyRuntime ?? (() => undefined),
        persist: async () => { if (saveFails) throw new Error('disk full') }
      })
      settings = next
      return settings
    }),
    publishSettings: vi.fn()
  }
  registerSecureDnsIpc(ipcMain, host)
  const invoke = (...args: unknown[]) => Promise.resolve().then(() => handlers.get('settings:set-secure-dns')!({} as IpcMainInvokeEvent, ...args))
  return { invoke, host, app, settings: () => settings, failSaves: () => { saveFails = true } }
}

describe('secure DNS rules', () => {
  it('takes an https provider address, with {?dns} for one asked with GET', () => {
    for (const template of [...SECURE_DNS_PROVIDERS.map((provider) => provider.template), ' https://dns.example/dns-query ', 'https://127.0.0.1:8443/dns-query{?dns}']) {
      expect(isSecureDnsTemplate(template), template).toBe(true)
    }
    for (const template of [
      '', 'http://dns.example/dns-query', 'dns.example/dns-query', 'https://dns.example/a b', 'https://user:secret@dns.example/dns',
      'https://dns.example/dns#x', 'https://dns.example/{dns}', 'https://dns.example/dns-query{?dns', `https://dns.example/${'a'.repeat(2_048)}`
    ]) {
      expect(isSecureDnsTemplate(template), template).toBe(false)
    }
  })

  it('reads back a known mode, and Secure only with a provider to ask', () => {
    expect(readSecureDns(undefined, undefined)).toEqual({ secureDnsMode: 'automatic', secureDnsTemplate: '' })
    expect(readSecureDns('off', CLOUDFLARE)).toEqual({ secureDnsMode: 'off', secureDnsTemplate: CLOUDFLARE })
    expect(readSecureDns('secure', ` ${CLOUDFLARE} `)).toEqual({ secureDnsMode: 'secure', secureDnsTemplate: CLOUDFLARE })
    expect(readSecureDns('secure', 'http://dns.example/')).toEqual({ secureDnsMode: 'automatic', secureDnsTemplate: '' })
    expect(readSecureDns('always', CLOUDFLARE)).toEqual({ secureDnsMode: 'automatic', secureDnsTemplate: CLOUDFLARE })
  })

  it('asks the chosen provider only in Secure mode', () => {
    expect(hostResolverOptions({ secureDnsMode: 'secure', secureDnsTemplate: CLOUDFLARE }))
      .toEqual({ secureDnsMode: 'secure', secureDnsServers: [CLOUDFLARE] })
    expect(hostResolverOptions({ secureDnsMode: 'automatic', secureDnsTemplate: CLOUDFLARE }))
      .toEqual({ secureDnsMode: 'automatic', secureDnsServers: [] })
    expect(hostResolverOptions({ secureDnsMode: 'off', secureDnsTemplate: CLOUDFLARE }))
      .toEqual({ secureDnsMode: 'off', secureDnsServers: [] })
  })
})

describe('secure DNS in main', () => {
  it('applies a change to Chromium before it saves it, and keeps the provider for later', async () => {
    const { invoke, host, app, settings } = secureDnsIpc()
    const result = await invoke('secure', ` ${CLOUDFLARE} `) as AppSettings
    expect(host.assertTrustedSender).toHaveBeenCalledOnce()
    expect(app.configureHostResolver).toHaveBeenLastCalledWith({ secureDnsMode: 'secure', secureDnsServers: [CLOUDFLARE] })
    expect(settings()).toMatchObject({ secureDnsMode: 'secure', secureDnsTemplate: CLOUDFLARE })
    expect(result).toMatchObject({ secureDnsMode: 'secure', secureDnsTemplate: CLOUDFLARE })
    expect(host.publishSettings).toHaveBeenCalledOnce()
    await invoke('off', CLOUDFLARE)
    expect(app.configureHostResolver).toHaveBeenLastCalledWith({ secureDnsMode: 'off', secureDnsServers: [] })
    expect(settings()).toMatchObject({ secureDnsMode: 'off', secureDnsTemplate: CLOUDFLARE })
    await invoke('automatic', '')
    expect(app.configureHostResolver).toHaveBeenLastCalledWith({ secureDnsMode: 'automatic', secureDnsServers: [] })
  })

  it('refuses a provider Hronaut cannot use, and malformed arguments, without changing anything', async () => {
    const { invoke, host, app, settings } = secureDnsIpc()
    for (const template of ['', 'http://dns.example/dns-query', 'https://user:secret@dns.example/dns']) {
      await expect(invoke('secure', template), template).rejects.toMatchObject({ key: 'appErrors.settings.secureDnsRejected' })
    }
    await expect(invoke('off', 'not an address')).rejects.toMatchObject({ key: 'appErrors.settings.secureDnsRejected' })
    for (const args of [['always', ''], ['secure'], ['secure', 1], ['off', 'x'.repeat(2_049)]]) {
      await expect(invoke(...args)).rejects.toThrow(TypeError)
    }
    expect(app.configureHostResolver).not.toHaveBeenCalled()
    expect(host.updateSettings).not.toHaveBeenCalled()
    expect(settings()).toMatchObject({ secureDnsMode: 'automatic', secureDnsTemplate: '' })
  })

  it('puts the previous setting back in Chromium when it cannot be saved or Chromium refuses it', async () => {
    const saveFailure = secureDnsIpc({ secureDnsMode: 'off' })
    saveFailure.failSaves()
    await expect(saveFailure.invoke('secure', CLOUDFLARE)).rejects.toThrow('disk full')
    expect(saveFailure.app.configureHostResolver.mock.calls.map(([options]) => options)).toEqual([
      { secureDnsMode: 'secure', secureDnsServers: [CLOUDFLARE] },
      { secureDnsMode: 'off', secureDnsServers: [] }
    ])
    expect(saveFailure.settings().secureDnsMode).toBe('off')

    const refused = secureDnsIpc({ secureDnsMode: 'off' })
    refused.app.configureHostResolver.mockImplementationOnce(() => { throw new Error('not a valid DoH template') })
    await expect(refused.invoke('secure', CLOUDFLARE)).rejects.toMatchObject({ key: 'appErrors.settings.secureDnsRejected' })
    expect(refused.app.configureHostResolver).toHaveBeenLastCalledWith({ secureDnsMode: 'off', secureDnsServers: [] })
    expect(refused.settings().secureDnsMode).toBe('off')
  })

  it('answers only Hronaut\'s own windows', async () => {
    const { invoke, host, app } = secureDnsIpc()
    host.assertTrustedSender.mockImplementation(() => { throw new Error('Untrusted sender') })
    await expect(invoke('off', '')).rejects.toThrow('Untrusted sender')
    expect(app.configureHostResolver).not.toHaveBeenCalled()
  })

  it('applies the saved setting at startup, and Automatic when Chromium refuses the saved provider', () => {
    const app = { configureHostResolver: vi.fn() }
    applySavedSecureDns(app, { secureDnsMode: 'secure', secureDnsTemplate: CLOUDFLARE })
    expect(app.configureHostResolver).toHaveBeenLastCalledWith({ secureDnsMode: 'secure', secureDnsServers: [CLOUDFLARE] })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      app.configureHostResolver.mockImplementationOnce(() => { throw new Error('not a valid DoH template') })
      applySavedSecureDns(app, { secureDnsMode: 'secure', secureDnsTemplate: CLOUDFLARE })
      expect(app.configureHostResolver).toHaveBeenLastCalledWith({ secureDnsMode: 'automatic', secureDnsServers: [] })
      expect(warn).toHaveBeenCalledOnce()
    } finally {
      warn.mockRestore()
    }
  })
})

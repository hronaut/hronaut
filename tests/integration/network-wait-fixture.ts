import type { ElectronApplication } from '@playwright/test'

type RegistrationProbe = { registered: boolean; events: string[]; restore(): void }
type RegistrationScope = typeof globalThis & { __networkWaitRegistration?: RegistrationProbe }

/** Test-only observation of the controller's synchronous registration stack. */
export async function installNetworkWaitProbe(app: ElectronApplication, url: string, sequence: string): Promise<void> {
  await app.evaluate(({ webContents }, { url, sequence }) => {
    const page = webContents.getAllWebContents().find(p => p.getURL() === url)!
    const originalTimeout = globalThis.setTimeout
    const onMessage = (_event: unknown, method: string, params: Record<string, unknown>) => {
      if (method !== 'Network.requestWillBeSent') return
      const requestUrl = new URL(String((params.request as { url: string }).url))
      if (requestUrl.origin === new URL(url).origin && requestUrl.pathname === '/wait-probe' && requestUrl.searchParams.get('sequence') === sequence) probe.events.push('request-captured')
    }
    const probe: RegistrationProbe = { registered: false, events: [], restore: () => {
      globalThis.setTimeout = originalTimeout
      page.debugger.removeListener('message', onMessage)
    } }
    ;(globalThis as RegistrationScope).__networkWaitRegistration = probe
    page.debugger.on('message', onMessage)
    globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
      const timer = originalTimeout(callback, delay, ...args)
      if (delay === 5_000 && String(callback).includes('waiting for a matching network')) {
        probe.events.push('wait-timer-created')
        // Coupled deliberately to NetworkWaitController.wait: add/set/notify are
        // synchronous after timer creation. Preserve its callback, deadline and
        // timer result; observe only after that registration stack completes.
        queueMicrotask(() => { probe.registered = true; probe.events.push('registration-stack-complete') })
      }
      return timer
    }) as typeof setTimeout
  }, { url, sequence })
}

export async function dispatchNetworkWaitProbe(app: ElectronApplication, url: string, sequence: string): Promise<void> {
  await app.evaluate(async ({ webContents }, { url, sequence }) => {
    ;(globalThis as RegistrationScope).__networkWaitRegistration!.events.push('fetch-dispatched')
    await webContents.getAllWebContents().find(p => p.getURL() === url)!.executeJavaScript(`window.runNetworkWaitProbe(${JSON.stringify(sequence)})`)
  }, { url, sequence })
}

export async function readNetworkWaitProbe(app: ElectronApplication): Promise<Omit<RegistrationProbe, 'restore'>> {
  return app.evaluate(() => {
    const probe = (globalThis as RegistrationScope).__networkWaitRegistration!
    return { registered: probe.registered, events: probe.events }
  })
}

export async function restoreNetworkWaitProbe(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => {
    ;(globalThis as RegistrationScope).__networkWaitRegistration?.restore()
    delete (globalThis as RegistrationScope).__networkWaitRegistration
  })
}

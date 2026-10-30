/** A service worker as the page reports it, before main redacts its address. */
export interface PwaPageWorker {
  scriptUrl: string
  state: string
}

/** The page's service worker registrations, before main redacts them. */
export interface PwaPageRegistrations {
  supported: boolean
  controlled: boolean
  controller?: PwaPageWorker
  registrations: Array<{
    scope: string
    updateViaCache: string
    installing?: PwaPageWorker
    waiting?: PwaPageWorker
    active?: PwaPageWorker
    navigationPreload?: { supported: boolean }
  }>
  truncated?: boolean
  maxNameChars?: number
}

/** Runs in the page: lists its service worker registrations, at most maxRegistrations, and changes none of them. */
export async function pwaRegistrationsInPage(maxRegistrations: number, maxNameChars: number): Promise<PwaPageRegistrations> {
  if (!('serviceWorker' in navigator)) return { controlled: false, registrations: [], supported: false }
  const worker = (value: ServiceWorker | null | undefined): PwaPageWorker | undefined => value ? {
    scriptUrl: String(value.scriptURL || '').slice(0, 4096),
    state: String(value.state || 'parsed')
  } : undefined
  const allRegistrations = await navigator.serviceWorker.getRegistrations()
  const registrations = allRegistrations
    .slice(0, maxRegistrations)
    .map((registration) => ({
      scope: String(registration.scope || '').slice(0, 4096),
      updateViaCache: String(registration.updateViaCache || 'imports'),
      installing: worker(registration.installing),
      waiting: worker(registration.waiting),
      active: worker(registration.active),
      navigationPreload: registration.navigationPreload ? { supported: true } : undefined
    }))
  return {
    controlled: Boolean(navigator.serviceWorker.controller),
    controller: worker(navigator.serviceWorker.controller),
    registrations,
    supported: true,
    truncated: allRegistrations.length > maxRegistrations,
    maxNameChars
  }
}

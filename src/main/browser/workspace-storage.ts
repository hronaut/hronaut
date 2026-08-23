import { randomUUID } from 'node:crypto'
import {
  session,
  WebContentsView,
  type Cookie,
  type CookiesSetDetails,
  type Session,
  type WebContents
} from 'electron'

const STORAGE_TRANSFER_TIMEOUT_MS = 8_000

export interface WorkspaceStorageTransferOptions {
  sourcePartition: string
  targetPartition: string
  origins: string[]
  copyAllCookies: boolean
  copyLocalStorage: boolean
  configureSession?: (browserSession: Session) => void
}

export interface WorkspaceStorageTransferResult {
  cookieCount: number
  localStorageOriginCount: number
  localStorageItemCount: number
  origins: string[]
}

interface LocalStorageRollbackEntry {
  origin: string
  keys: string[]
  previous: Array<[string, string]>
}

export async function flushBrowserSessionStorage(browserSession: Session): Promise<void> {
  const results = await Promise.allSettled([
    browserSession.flushStorageData(),
    browserSession.cookies.flushStore()
  ])
  const errors = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : [])
  if (errors.length) {
    throw new AggregateError(errors, 'Browser profile storage could not be fully flushed.')
  }
}

export function workspacePartition(defaultPartition: string, storageId: string): string {
  const profile = defaultPartition.startsWith('persist:') ? defaultPartition.slice('persist:'.length) : defaultPartition
  return `persist:${profile}-workspace-${storageId}`
}

export function normalizeWorkspaceStorageOrigins(values: string[]): string[] {
  const origins = new Set<string>()
  for (const value of values) {
    const parsed = new URL(value)
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) {
      throw new TypeError(`Workspace storage origin must be HTTP or HTTPS: ${value}`)
    }
    origins.add(parsed.origin)
  }
  return [...origins].sort()
}

function cookieIdentity(cookie: Cookie): string {
  return `${cookie.domain ?? ''}\u0000${cookie.path ?? '/'}\u0000${cookie.name}`
}

function cookieUrl(cookie: Cookie): string {
  const hostname = cookie.domain?.replace(/^\./, '')
  if (!hostname) throw new Error(`Cannot copy cookie ${cookie.name} without a domain`)
  return `${cookie.secure ? 'https' : 'http'}://${hostname}${cookie.path || '/'}`
}

function cookieDetails(cookie: Cookie): CookiesSetDetails {
  return {
    url: cookieUrl(cookie),
    name: cookie.name,
    value: cookie.value,
    ...(!cookie.hostOnly && cookie.domain ? { domain: cookie.domain } : {}),
    ...(cookie.path ? { path: cookie.path } : {}),
    ...(cookie.secure ? { secure: true } : {}),
    ...(cookie.httpOnly ? { httpOnly: true } : {}),
    ...(cookie.expirationDate !== undefined ? { expirationDate: cookie.expirationDate } : {}),
    ...(cookie.sameSite ? { sameSite: cookie.sameSite } : {})
  }
}

async function cookiesForTransfer(
  source: Session,
  origins: string[],
  copyAllCookies: boolean
): Promise<Cookie[]> {
  if (copyAllCookies) return source.cookies.get({})
  const selectedOrigins = origins.map((origin) => new URL(origin))
  const cookies = new Map<string, Cookie>()
  for (const cookie of await source.cookies.get({})) {
    const domain = cookie.domain?.replace(/^\./, '').toLowerCase()
    if (!domain) continue
    const matches = selectedOrigins.some((origin) => {
      if (cookie.secure && origin.protocol !== 'https:') return false
      const hostname = origin.hostname.toLowerCase()
      return cookie.hostOnly ? hostname === domain : hostname === domain || hostname.endsWith(`.${domain}`)
    })
    if (matches) cookies.set(cookieIdentity(cookie), cookie)
  }
  return [...cookies.values()]
}

class LocalStorageSurface {
  private readonly view: WebContentsView
  private readonly webContents: WebContents
  private pendingRequest: { resolve: () => void; reject: (error: Error) => void; timer: NodeJS.Timeout } | null = null

  constructor(partition: string) {
    this.view = new WebContentsView({
      webPreferences: {
        partition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false
      }
    })
    this.webContents = this.view.webContents
    this.webContents.debugger.attach('1.3')
    this.webContents.debugger.on('message', (_event, method, params) => {
      if (method !== 'Fetch.requestPaused') return
      const request = params as { requestId?: string }
      if (!request.requestId) return
      void this.webContents.debugger.sendCommand('Fetch.fulfillRequest', {
        requestId: request.requestId,
        responseCode: 200,
        responseHeaders: [
          { name: 'Content-Type', value: 'text/html; charset=utf-8' },
          { name: 'Content-Security-Policy', value: "default-src 'none'" },
          { name: 'Cache-Control', value: 'no-store' }
        ],
        body: Buffer.from('<!doctype html><meta charset="utf-8"><title>Hronaut workspace storage</title>').toString('base64')
      }).then(() => {
        if (!this.pendingRequest) return
        clearTimeout(this.pendingRequest.timer)
        this.pendingRequest.resolve()
        this.pendingRequest = null
      }, (error: unknown) => {
        if (!this.pendingRequest) return
        clearTimeout(this.pendingRequest.timer)
        this.pendingRequest.reject(error instanceof Error ? error : new Error(String(error)))
        this.pendingRequest = null
      })
    })
  }

  async initialize(): Promise<void> {
    await this.webContents.debugger.sendCommand('Fetch.enable', {
      patterns: [{ urlPattern: '*', resourceType: 'Document', requestStage: 'Request' }]
    })
  }

  async loadOrigin(origin: string): Promise<void> {
    if (this.pendingRequest) throw new Error('A workspace storage transfer is already loading an origin')
    const intercepted = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pendingRequest) return
        this.pendingRequest = null
        reject(new Error(`Timed out preparing workspace storage for ${origin}`))
      }, STORAGE_TRANSFER_TIMEOUT_MS)
      timer.unref()
      this.pendingRequest = { resolve, reject, timer }
    })
    await Promise.all([
      this.webContents.loadURL(`${origin}/.well-known/hronaut-workspace-storage-${randomUUID()}`),
      intercepted
    ])
  }

  async read(): Promise<Array<[string, string]>> {
    return this.webContents.executeJavaScript(`(() => {
      const items = [];
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key !== null) items.push([key, localStorage.getItem(key) ?? '']);
      }
      return items;
    })()`, true) as Promise<Array<[string, string]>>
  }

  async merge(items: Array<[string, string]>): Promise<void> {
    await this.webContents.executeJavaScript(`(() => {
      for (const [key, value] of ${JSON.stringify(items)}) localStorage.setItem(key, value);
    })()`, true)
  }

  async restore(entry: LocalStorageRollbackEntry): Promise<void> {
    await this.webContents.executeJavaScript(`(() => {
      for (const key of ${JSON.stringify(entry.keys)}) localStorage.removeItem(key);
      for (const [key, value] of ${JSON.stringify(entry.previous)}) localStorage.setItem(key, value);
    })()`, true)
  }

  close(): void {
    if (this.pendingRequest) {
      clearTimeout(this.pendingRequest.timer)
      this.pendingRequest.reject(new Error('Workspace storage transfer was canceled'))
      this.pendingRequest = null
    }
    if (!this.webContents.isDestroyed()) this.webContents.close()
  }
}

export async function transferWorkspaceStorage(
  options: WorkspaceStorageTransferOptions
): Promise<WorkspaceStorageTransferResult> {
  if (options.sourcePartition === options.targetPartition) {
    throw new Error('Source and target workspace storage must be different')
  }
  const origins = normalizeWorkspaceStorageOrigins(options.origins)
  const source = session.fromPartition(options.sourcePartition, { cache: true })
  const target = session.fromPartition(options.targetPartition, { cache: true })
  options.configureSession?.(source)
  options.configureSession?.(target)

  const cookies = await cookiesForTransfer(source, origins, options.copyAllCookies)
  const cookieIdentities = new Set(cookies.map(cookieIdentity))
  const previousCookies = (await target.cookies.get({})).filter((cookie) => cookieIdentities.has(cookieIdentity(cookie)))
  const localStorageRollback: LocalStorageRollbackEntry[] = []
  let localStorageOriginCount = 0
  let localStorageItemCount = 0
  try {
    for (const cookie of cookies) await target.cookies.set(cookieDetails(cookie))

    if (options.copyLocalStorage && origins.length) {
      const sourceSurface = new LocalStorageSurface(options.sourcePartition)
      const targetSurface = new LocalStorageSurface(options.targetPartition)
      try {
        await Promise.all([sourceSurface.initialize(), targetSurface.initialize()])
        for (const origin of origins) {
          await Promise.all([sourceSurface.loadOrigin(origin), targetSurface.loadOrigin(origin)])
          const items = await sourceSurface.read()
          if (!items.length) continue
          const targetItems = new Map(await targetSurface.read())
          const keys = items.map(([key]) => key)
          localStorageRollback.push({
            origin,
            keys,
            previous: keys.flatMap((key) => targetItems.has(key) ? [[key, targetItems.get(key)!] as [string, string]] : [])
          })
          await targetSurface.merge(items)
          localStorageOriginCount += 1
          localStorageItemCount += items.length
        }
      } finally {
        sourceSurface.close()
        targetSurface.close()
      }
    }
    await flushBrowserSessionStorage(target)
    return {
      cookieCount: cookies.length,
      localStorageOriginCount,
      localStorageItemCount,
      origins
    }
  } catch (transferError) {
    const rollbackErrors: unknown[] = []
    if (localStorageRollback.length) {
      const targetSurface = new LocalStorageSurface(options.targetPartition)
      try {
        await targetSurface.initialize()
        for (const entry of [...localStorageRollback].reverse()) {
          try {
            await targetSurface.loadOrigin(entry.origin)
            await targetSurface.restore(entry)
          } catch (error) {
            rollbackErrors.push(error)
          }
        }
      } catch (error) {
        rollbackErrors.push(error)
      } finally {
        targetSurface.close()
      }
    }
    for (const cookie of cookies) {
      try {
        await target.cookies.remove(cookieUrl(cookie), cookie.name)
      } catch (error) {
        rollbackErrors.push(error)
      }
    }
    for (const cookie of previousCookies) {
      try {
        await target.cookies.set(cookieDetails(cookie))
      } catch (error) {
        rollbackErrors.push(error)
      }
    }
    try {
      await flushBrowserSessionStorage(target)
    } catch (error) {
      rollbackErrors.push(error)
    }
    if (rollbackErrors.length) {
      throw new AggregateError(
        [transferError, ...rollbackErrors],
        'Workspace storage transfer failed and the destination could not be fully restored.'
      )
    }
    throw transferError
  }
}

export async function destroyWorkspaceStorage(
  partition: string,
  configureSession?: (browserSession: Session) => void
): Promise<void> {
  const browserSession = session.fromPartition(partition, { cache: true })
  configureSession?.(browserSession)
  await browserSession.closeAllConnections()
  await browserSession.clearData()
  await flushBrowserSessionStorage(browserSession)
}

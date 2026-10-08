import { createServer } from 'node:http'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ElectronApplication, Page } from '@playwright/test'
import type { ReactInspectionAction, ReactInspectionResult } from '../../src/shared/react-inspection.js'
import { closeFixtureServer, expect, test as base } from './fixtures.js'
import { reactInspectionBundle } from './react-inspection-bundle.js'

export function decode<T>(result: CallToolResult): T {
  return JSON.parse(result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')) as T
}
export function rejected(result: CallToolResult): boolean {
  if (result.isError) return true
  return ['unavailable', 'interrupted', 'timed-out', 'stale-observation'].includes(decode<ReactInspectionResult>(result).status)
}
export interface Workspace { id: string; resumeKey: string }
interface NativeHold { entered: boolean; objectId?: string; release(): void; restore(): void }
interface TestGlobals { __reactHold?: NativeHold; __reactMenu?: Electron.Menu; __restoreReactMenu?: () => void }
export interface ReactFixture {
  client: Client
  origin: string
  workspace: Workspace
  tabId: string
  page: Page
  contentsId: number
  call(name: string, args: Record<string, unknown>): Promise<CallToolResult>
  success<T>(operation: Promise<CallToolResult>): Promise<T>
  react(action: ReactInspectionAction, subtreeId?: string): Promise<CallToolResult>
  enable(path?: string): Promise<ReactInspectionResult>
  navigate(path: string): Promise<void>
  holdDocument(path: string): void
  releaseDocument(): void
  holdRead(): Promise<void>
  entered(): Promise<void>
  release(): Promise<void>
  readMenu(): Promise<{ enabled: boolean; label: string | undefined }>
  toggleMenu(): Promise<void>
  reconnect(token: string): Promise<void>
}
export const test = base.extend<{ react: ReactFixture }>({
  react: async ({ appWindow, electronApp, mcpPort, mcpToken }, use) => {
    let heldPath: string | undefined
    let releaseDocument = () => {}
    let documentGate = Promise.resolve()
    const server = createServer((request, response) => {
      const send = () => response.writeHead(200, { 'content-type': request.url === '/react.js' ? 'application/javascript' : 'text/html' })
        .end(request.url === '/react.js' ? reactInspectionBundle : request.url?.startsWith('/bare') ? '<title>React bare fixture</title>'
          : '<title>React inspection fixture</title><div id="root"></div><script src="/react.js"></script>')
      if (request.url === heldPath) void documentGate.then(send)
      else send()
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture port')
    const origin = `http://127.0.0.1:${address.port}`
    let client = new McpClient({ name: 'react-inspection-test', version: '1' })
    const connect = async () => {
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
      }))
    }
    const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<CallToolResult>
    const success = async <T>(operation: Promise<CallToolResult>): Promise<T> => {
      const result = await operation
      expect(result.isError, 'Fixture operation must succeed').not.toBe(true)
      return decode<T>(result)
    }
    try {
      await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false } }).toBe(true)
      await connect()
      const workspace = await success<Workspace>(call('browser_workspaces', { action: 'create', storage: 'scratch', name: 'React integration' }))
      const tabId = (await success<{activeTabId: string}>(call('browser_new_tab', { workspaceId: workspace.id, url: origin + '/initial' }))).activeTabId
      await expect.poll(() => electronApp.context().pages().some(page => page.url() === origin + '/initial')).toBe(true)
      const page = electronApp.context().pages().find(page => page.url() === origin + '/initial')!
      await expect(page.locator('span')).toHaveCount(1)
      const contentsId = await electronApp.evaluate(({ webContents }, url) => {
        const contents = webContents.getAllWebContents().find(contents => contents.getURL() === url)
        if (!contents) throw new Error('Fixture contents missing')
        return contents.id
      }, origin + '/initial')
      const react = (action: ReactInspectionAction, subtreeId?: string) => call('browser_react', { workspaceId: workspace.id, tabId, action, ...(subtreeId ? { subtreeId } : {}) })
      const navigate = async (path: string) => { await success(call('browser_navigate', { workspaceId: workspace.id, tabId, url: origin + path })) }
      const readMenu = async () => {
        await captureMenu(electronApp)
        await appWindow.evaluate(id => (window as unknown as {hronaut: {showTabContextMenu(id: string): Promise<void>}}).hronaut.showTabContextMenu(id), tabId)
        return electronApp.evaluate(() => {
          const menu = (globalThis as typeof globalThis & TestGlobals).__reactMenu
          return { enabled: menu?.getMenuItemById('react-inspection-enabled')?.checked === true, label: menu?.getMenuItemById('react-inspection-status')?.label }
        })
      }
      const fixture: ReactFixture = {
        get client() { return client }, origin, workspace, tabId, page, contentsId, call, success, react, navigate,
        enable: async (path = '/enabled') => {
          expect((await success<ReactInspectionResult>(react('enable'))).status).toBe('reload-required')
          await navigate(path)
          if (!path.startsWith('/bare')) await expect(page.locator('span')).toHaveCount(1)
          return success<ReactInspectionResult>(react('tree'))
        },
        holdDocument: path => { heldPath = path; documentGate = new Promise<void>(resolve => { releaseDocument = resolve }) },
        releaseDocument: () => { heldPath = undefined; releaseDocument() },
        holdRead: () => holdNativeRead(electronApp, contentsId),
        entered: () => expect.poll(() => electronApp.evaluate(() => (globalThis as typeof globalThis & TestGlobals).__reactHold?.entered)).toBe(true),
        release: () => electronApp.evaluate(() => { (globalThis as typeof globalThis & TestGlobals).__reactHold?.release() }),
        readMenu,
        toggleMenu: async () => {
          await readMenu()
          await electronApp.evaluate(() => {
            const item = (globalThis as typeof globalThis & TestGlobals).__reactMenu?.getMenuItemById('react-inspection-enabled')
            if (!item?.enabled) throw new Error('React control unavailable')
            ;(item.click as unknown as () => void)()
          })
        },
        reconnect: async token => {
          await client.close().catch(() => {})
          client = new McpClient({ name: 'react-inspection-resumed', version: '1' })
          await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
            requestInit: { headers: { authorization: `Bearer ${token}` } }
          }))
        }
      }
      await use(fixture)
    } finally {
      releaseDocument()
      await electronApp.evaluate(() => {
        const state = globalThis as typeof globalThis & TestGlobals
        state.__reactHold?.release(); state.__reactHold?.restore(); state.__restoreReactMenu?.()
        delete state.__reactHold; delete state.__reactMenu; delete state.__restoreReactMenu
      }).catch(() => {})
      await client.close().catch(() => {})
      await closeFixtureServer(server)
    }
  }
})
async function captureMenu(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ Menu }) => {
    const state = globalThis as typeof globalThis & TestGlobals
    if (state.__restoreReactMenu) return
    const original = Menu.prototype.popup
    state.__restoreReactMenu = () => { Menu.prototype.popup = original }
    Menu.prototype.popup = function () { state.__reactMenu = this }
  })
}
export async function holdNativeRead(app: ElectronApplication, contentsId: number): Promise<void> {
  await app.evaluate(({ webContents }, id) => {
    const page = webContents.fromId(id)
    if (!page) throw new Error('Fixture contents missing')
    const original = page.debugger.sendCommand.bind(page.debugger)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const state: NativeHold = { entered: false, release, restore: () => { page.debugger.sendCommand = original } }
    ;(globalThis as typeof globalThis & TestGlobals).__reactHold = state
    page.debugger.sendCommand = async (method: string, params?: Record<string, unknown>) => {
      const result: unknown = await original(method, params)
      if (method === 'Runtime.callFunctionOn' && String(params?.functionDeclaration).includes('react-inspection-read')) {
        state.objectId ??= String(params?.objectId)
        state.entered = true
        await gate
        state.restore()
      }
      return result
    }
  }, contentsId)
}
export { expect }

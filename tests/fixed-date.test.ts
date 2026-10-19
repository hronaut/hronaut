import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import type { IpcMain, WebContents } from 'electron'
import { FixedDateController, type FixedDateTarget } from '../src/main/browser/fixed-date/fixed-date.js'
import { registerFixedDateIpc } from '../src/main/fixed-date-ipc.js'

const AT = Date.UTC(2026, 11, 31, 23, 59, 30)
const ORIGIN = 'https://app.test'

function fixture() {
  const page = Object.assign(new EventEmitter(), { id: 3 }) as unknown as WebContents
  const workspace = {}
  const target: FixedDateTarget = { identity: {}, page, url: `${ORIGIN}/calendar?draft=1`, workspaceId: 'w1', workspaceIdentity: workspace }
  const controller = new FixedDateController({
    resolve: tabId => { if (tabId !== 'tab-1') throw new Error('No tab'); return { ...target } },
    tabIdOf: candidate => candidate === page ? 'tab-1' : undefined
  })
  const authority = { assertCurrent: vi.fn() }
  const navigate = (url: string) => {
    page.emit('did-start-navigation', {}, url, false, true)
    page.emit('did-navigate', {}, url)
  }
  return { controller, page, target, authority, navigate }
}

it('installs the staged instant only in new documents of the staged origin', () => {
  const { controller, page, authority } = fixture()
  expect(controller.stage('tab-1', AT, authority)).toEqual({
    status: 'staged', armed: true, fixedDate: '2026-12-31T23:59:30.000Z', epochMs: AT, origin: ORIGIN,
    currentDocument: 'native', reloadRequired: true
  })
  expect(controller.bootstrap(page, ORIGIN)).toEqual({ enabled: true, epochMs: AT })
  expect(controller.status('tab-1')).toMatchObject({ status: 'active', currentDocument: 'fixed', currentDocumentFixedDate: '2026-12-31T23:59:30.000Z', reloadRequired: false })
  expect(controller.bootstrap(page, ORIGIN)).toEqual({ enabled: true, epochMs: AT })
  // Staging (and the status it returns), both documents and the status check the staging authority for the staged origin.
  expect(authority.assertCurrent).toHaveBeenCalledTimes(5)
  expect(authority.assertCurrent.mock.calls.every(([origin]) => origin === ORIGIN)).toBe(true)
})

it('reports a setting whose authority changed as disarmed before the next document', () => {
  const { controller, authority } = fixture()
  controller.stage('tab-1', AT, authority)
  authority.assertCurrent.mockImplementation(() => { throw new Error('Workspace ownership changed') })
  expect(controller.status('tab-1')).toMatchObject({ status: 'disarmed', armed: false, disarmedReason: 'authority-changed' })
})

it('says the document is unknown when a cached page may come back, or the renderer exits', () => {
  const { controller, page, authority } = fixture()
  controller.stage('tab-1', AT, authority)
  controller.bootstrap(page, ORIGIN)
  controller.bootstrap(page, 'https://other.test')
  expect(controller.status('tab-1')).toMatchObject({ status: 'disarmed', currentDocument: 'native' })
  // Going back can restore the cached document that has the fixed Date without asking again.
  page.emit('did-start-navigation', {}, `${ORIGIN}/calendar`, false, true)
  expect(controller.status('tab-1')).toMatchObject({ currentDocument: 'unknown', reloadRequired: true })
  controller.bootstrap(page, ORIGIN)
  expect(controller.status('tab-1')).toMatchObject({ currentDocument: 'native', reloadRequired: false })
  page.emit('render-process-gone', {}, { reason: 'crashed' })
  expect(controller.status('tab-1')).toMatchObject({ currentDocument: 'unknown' })
})

it('disarms instead of installing in a document of another origin, and stays disarmed', () => {
  const { controller, page, authority } = fixture()
  controller.stage('tab-1', AT, authority)
  expect(controller.bootstrap(page, 'https://other.test')).toEqual({ enabled: false })
  expect(controller.status('tab-1')).toEqual({
    status: 'disarmed', armed: false, fixedDate: '2026-12-31T23:59:30.000Z', epochMs: AT, origin: ORIGIN,
    currentDocument: 'native', reloadRequired: false, disarmedReason: 'origin-changed'
  })
  expect(controller.bootstrap(page, ORIGIN)).toEqual({ enabled: false })
})

it('disarms when the staging authority or the workspace changed', () => {
  const changedAuthority = fixture()
  changedAuthority.controller.stage('tab-1', AT, changedAuthority.authority)
  changedAuthority.authority.assertCurrent.mockImplementation(() => { throw new Error('Human input changed the target page') })
  expect(changedAuthority.controller.bootstrap(changedAuthority.page, ORIGIN)).toEqual({ enabled: false })
  expect(changedAuthority.controller.status('tab-1')).toMatchObject({ status: 'disarmed', disarmedReason: 'authority-changed' })

  const moved = fixture()
  moved.controller.stage('tab-1', AT, moved.authority)
  moved.target.workspaceIdentity = {}
  expect(moved.controller.bootstrap(moved.page, ORIGIN)).toEqual({ enabled: false })
  expect(moved.controller.status('tab-1')).toMatchObject({ status: 'disarmed', disarmedReason: 'workspace-changed' })
})

it('refuses to stage without authority or on a page that is not HTTP(S)', () => {
  const { controller, target, authority } = fixture()
  authority.assertCurrent.mockImplementationOnce(() => { throw new Error('MCP control changed') })
  expect(() => controller.stage('tab-1', AT, authority)).toThrow('MCP control changed')
  target.url = 'hronaut://home/'
  expect(() => controller.stage('tab-1', AT, authority)).toThrow('Open an HTTP(S) page')
  expect(controller.status('tab-1')).toEqual({ status: 'off', armed: false, currentDocument: 'native', reloadRequired: false })
})

it('reports the residue a reset leaves until the document reloads', () => {
  const { controller, page, authority } = fixture()
  controller.stage('tab-1', AT, authority)
  controller.bootstrap(page, ORIGIN)
  expect(controller.reset('tab-1')).toMatchObject({ status: 'reset-reload-required', armed: false, currentDocument: 'fixed', reloadRequired: true })
  expect(controller.bootstrap(page, ORIGIN)).toEqual({ enabled: false })
  expect(controller.status('tab-1')).toEqual({ status: 'off', armed: false, currentDocument: 'native', reloadRequired: false })
})

it('says the document is unknown after a navigation starts, and native on a page that is not HTTP(S)', () => {
  const { controller, page, authority, navigate } = fixture()
  controller.stage('tab-1', AT, authority)
  controller.bootstrap(page, ORIGIN)
  page.emit('did-start-navigation', {}, `${ORIGIN}/report.pdf`, false, true)
  expect(controller.status('tab-1')).toMatchObject({ status: 'staged', currentDocument: 'unknown', reloadRequired: true })
  page.emit('did-start-navigation', {}, `${ORIGIN}/#section`, true, true)
  expect(controller.status('tab-1')).toMatchObject({ currentDocument: 'unknown' })
  navigate('about:blank')
  expect(controller.status('tab-1')).toMatchObject({ currentDocument: 'native' })
})

it('stays armed through a page that is not HTTP(S), such as a sleeping tab, and installs when the origin loads again', () => {
  const { controller, page, authority, navigate } = fixture()
  controller.stage('tab-1', AT, authority)
  controller.bootstrap(page, ORIGIN)
  navigate('data:text/html,sleeping')
  expect(controller.status('tab-1')).toMatchObject({ status: 'staged', armed: true, currentDocument: 'native' })
  navigate(`${ORIGIN}/calendar`)
  expect(controller.bootstrap(page, ORIGIN)).toEqual({ enabled: true, epochMs: AT })
  expect(controller.status('tab-1')).toMatchObject({ status: 'active', currentDocument: 'fixed' })
})

it('replaces an earlier instant and needs a reload to apply the new one', () => {
  const { controller, page, authority } = fixture()
  controller.stage('tab-1', AT, authority)
  controller.bootstrap(page, ORIGIN)
  expect(controller.stage('tab-1', 0, authority)).toMatchObject({
    status: 'staged', fixedDate: '1970-01-01T00:00:00.000Z', currentDocumentFixedDate: '2026-12-31T23:59:30.000Z', reloadRequired: true
  })
  expect(controller.bootstrap(page, ORIGIN)).toEqual({ enabled: true, epochMs: 0 })
})

it('does not track tabs that never had a fixed Date, and forgets a closed one', () => {
  const { controller, page, authority } = fixture()
  expect(controller.bootstrap(page, ORIGIN)).toEqual({ enabled: false })
  expect(page.listenerCount('did-start-navigation')).toBe(0)
  controller.stage('tab-1', AT, authority)
  page.emit('destroyed')
  expect(controller.bootstrap(page, ORIGIN)).toEqual({ enabled: false })
})

it('answers only the top-level frame of a tab', () => {
  let listener: ((event: unknown) => void) | undefined
  const fixedDateBootstrap = vi.fn(() => ({ enabled: true as const, epochMs: AT }))
  let tabs: { fixedDateBootstrap: typeof fixedDateBootstrap } | null = null
  registerFixedDateIpc({ ipcMain: { on: (_channel: string, handler: unknown) => { listener = handler as typeof listener } } as unknown as Pick<IpcMain, 'on'>, tabs: () => tabs as never })
  const mainFrame = { origin: ORIGIN }
  const ask = (senderFrame: unknown) => {
    const event = { sender: { mainFrame }, senderFrame, returnValue: undefined as unknown }
    listener!(event)
    return event.returnValue
  }
  expect(ask(mainFrame)).toEqual({ enabled: false })
  tabs = { fixedDateBootstrap }
  expect(ask({ origin: ORIGIN })).toEqual({ enabled: false })
  expect(ask(null)).toEqual({ enabled: false })
  expect(fixedDateBootstrap).not.toHaveBeenCalled()
  expect(ask(mainFrame)).toEqual({ enabled: true, epochMs: AT })
  expect(fixedDateBootstrap).toHaveBeenCalledWith({ mainFrame }, ORIGIN)
})

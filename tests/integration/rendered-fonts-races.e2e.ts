import { readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { test, expect, text } from './capability-fixtures.js'
import { closeFixtureServer } from './fixtures.js'

interface HeldFontInspection { held: boolean; events: string[]; release(): void; restore(): void }
for (const phase of ['inspection', 'font-read'] as const) for (const variant of ['empty-editor', 'comment-editor', 'multiple-text', 'text-data', 'design-mode', 'closed-shadow', 'unchanged'] as const) {
  test(`rejects unbound-child font races: ${variant} during ${phase}`, async ({ capabilities, electronApp }, testInfo) => {
    const font = await readFile('tests/fixtures/fonts/fixture-A.ttf')
    const initial = variant === 'empty-editor' || variant === 'closed-shadow' ? '' : variant === 'comment-editor' ? 'A<!--marker-->' : 'A<!--marker-->A'
    const server = createServer((request, response) => {
      if (request.url === '/fixture.ttf') { response.writeHead(200, { 'content-type': 'font/ttf' }); response.end(font); return }
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end(`<style>@font-face{font-family:Fixture;src:url(/fixture.ttf)}div{font-family:Fixture;font-size:30px}</style><div>AAA</div><div id="target">${initial}</div>`)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address(); if (!address || typeof address === 'string') throw Error('Missing fixture address')
    const url = `http://127.0.0.1:${address.port}/`
    const { client, tabId } = capabilities
    let pending: Promise<CallToolResult> | undefined
    try {
      const navigation = await client.callTool({ name: 'browser_navigate', arguments: { tabId, url } }) as CallToolResult
      expect(navigation.isError, text(navigation)).not.toBe(true)
      await expect.poll(() => electronApp.context().pages().some(p => p.url() === url)).toBe(true)
      const page = electronApp.context().pages().find(p => p.url() === url)!
      await page.evaluate(() => document.fonts.ready.then(() => undefined))
      await electronApp.evaluate(({ webContents }, { url, phase }) => {
        const contents = webContents.getAllWebContents().find(p => p.getURL() === url)!
        const original = contents.executeJavaScriptInIsolatedWorld
        const originalCommand = contents.debugger.sendCommand
        let release!: () => void
        const gate = new Promise<void>(resolve => { release = resolve })
        const events: string[] = []
        const listener = (_event: unknown, method: string) => { if (method.startsWith('DOM.') && events.length < 100) events.push(method) }
        const held: HeldFontInspection = { held: false, events, release, restore: () => { contents.executeJavaScriptInIsolatedWorld = original; contents.debugger.sendCommand = originalCommand; contents.debugger.removeListener('message', listener) } }
        ;(globalThis as typeof globalThis & { __fontRace?: HeldFontInspection }).__fontRace = held
        contents.debugger.on('message', listener)
        contents.executeJavaScriptInIsolatedWorld = async function (...args) {
          const result = await original.apply(this, args)
          if (phase === 'inspection' && args[0] === 1006 && !held.held) { held.held = true; await gate; contents.executeJavaScriptInIsolatedWorld = original }
          return result
        }
        contents.debugger.sendCommand = async function (method, ...args) {
          if (phase === 'font-read' && method === 'CSS.getPlatformFontsForNode' && !held.held) { held.held = true; await gate }
          return originalCommand.call(this, method, ...args)
        }
      }, { url, phase })
      pending = client.callTool({ name: 'browser_element_inspect', arguments: { tabId, selector: '#target', includeFonts: true } }) as Promise<CallToolResult>
      await expect.poll(() => electronApp.evaluate(() => (globalThis as typeof globalThis & { __fontRace?: HeldFontInspection }).__fontRace?.held)).toBe(true)
      await page.evaluate(async variant => {
        const target = document.querySelector('#target')!
        if (variant === 'empty-editor' || variant === 'comment-editor') {
          const editor = document.createElement('span'); editor.contentEditable = 'true'; editor.textContent = 'AAA'; target.append(editor)
        } else if (variant === 'multiple-text') target.firstChild!.textContent = 'AAAA'
        else if (variant === 'text-data') (target.firstChild as Text).data = 'AAAA'
        else if (variant === 'design-mode') document.designMode = 'on'
        else if (variant === 'closed-shadow') target.attachShadow({ mode: 'closed' }).innerHTML = '<span>AAA</span>'
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      }, variant)
      await electronApp.evaluate(() => (globalThis as typeof globalThis & { __fontRace?: HeldFontInspection }).__fontRace?.release())
      const result = await pending
      const events = await electronApp.evaluate(() => (globalThis as typeof globalThis & { __fontRace?: HeldFontInspection }).__fontRace?.events)
      await writeFile(testInfo.outputPath('font-race.json'), JSON.stringify({ variant, phase, events, result }, null, 2))
      if (variant === 'unchanged') {
        expect(result.isError, text(result)).not.toBe(true)
        expect(JSON.parse(text(result)).renderedFonts).toMatchObject({ status: 'observed', fonts: [{ familyName: 'Hronaut Fixture A', glyphCount: 2 }] })
      } else {
        if (variant === 'closed-shadow') expect(events).toContain('DOM.shadowRootPushed')
        else if (variant !== 'design-mode') expect(events).toContain('DOM.childNodeCountUpdated')
        expect(result.isError, text(result)).toBe(true)
        expect(text(result)).toContain('changed during CSS provenance')
        expect(text(result)).not.toContain('renderedFonts')
      }
    } finally {
      await electronApp.evaluate(() => {
        const scope = globalThis as typeof globalThis & { __fontRace?: HeldFontInspection }
        scope.__fontRace?.release(); scope.__fontRace?.restore(); delete scope.__fontRace
      }).catch(() => undefined)
      await pending?.catch(() => undefined)
      await closeFixtureServer(server)
    }
  })
}

import { createServer } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeFixtureServer } from './fixtures.js'
import { expect, test } from './capability-fixtures.js'

type SaveDialog = { defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }
type DownloadsWindow = typeof window & { hronautDownloads: { list(): Promise<Array<{ filename?: string; state?: string }>> } }

/** A one-page PDF that says `text`, with the byte offsets its cross-reference table needs. */
function pdf(text: string): Buffer {
  const content = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(body.length)
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}

test('Save Page As saves an image, a PDF, text or JSON shown in a tab as the file itself, under its address\'s name, as Chrome does', async ({ capabilities, appWindow, electronApp }) => {
  const { tabId } = capabilities
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')
  const documents: Record<string, { type: string; body: Buffer }> = {
    '/images/pixel.png': { type: 'image/png', body: pixel },
    '/files/report.pdf': { type: 'application/pdf', body: pdf('Quarterly report') },
    '/api/status': { type: 'application/json', body: Buffer.from('{"status":"ok","items":[1,2,3]}') },
    '/notes': { type: 'text/plain; charset=utf-8', body: Buffer.from('hronaut-plain-text-marker\nsecond line\n') }
  }
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://fixture').pathname
    const document = documents[path]
    if (document) {
      response.writeHead(200, { 'content-type': document.type, 'content-length': document.body.length }).end(document.body)
      return
    }
    response.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>Start</title><p>hronaut-save-marker</p><img src="/images/pixel.png">')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const origin = `http://127.0.0.1:${address.port}`
  const folder = mkdtempSync(join(tmpdir(), 'hronaut-save-page-file-e2e-'))
  try {
    const visit = async (to: string) => {
      await appWindow.evaluate(`window.hronaut.navigate({ url: ${JSON.stringify(origin + to)}, tabId: ${JSON.stringify(tabId)} })`)
      await expect.poll(() => electronApp.evaluate(({ webContents }, address) => (
        webContents.getAllWebContents().some(candidate => candidate.getURL() === address && !candidate.isLoadingMainFrame())
      ), origin + to)).toBe(true)
    }
    // The system dialog is out of reach here: note what it is asked, and answer with the next name.
    await electronApp.evaluate(({ dialog }) => {
      const state = globalThis as typeof globalThis & { __saveDialogs?: SaveDialog[], __saveAnswers?: string[] }
      state.__saveDialogs = []
      state.__saveAnswers = []
      dialog.showSaveDialog = (async (_window: unknown, options: SaveDialog) => {
        state.__saveDialogs!.push({ defaultPath: options.defaultPath, filters: options.filters })
        const filePath = state.__saveAnswers!.shift()
        return filePath ? { canceled: false, filePath } : { canceled: true, filePath: '' }
      }) as typeof dialog.showSaveDialog
    })
    const lastDialog = () => electronApp.evaluate(() => (globalThis as typeof globalThis & { __saveDialogs?: SaveDialog[] }).__saveDialogs!.at(-1))
    // `sent` is the file the website sends, which the save is done once it holds; a web page is done once it is there.
    const save = async (to: string, name: string, sent?: Buffer) => {
      await visit(to)
      const chosen = join(folder, name)
      await electronApp.evaluate((_electron, filePath) => {
        (globalThis as typeof globalThis & { __saveAnswers?: string[] }).__saveAnswers!.push(filePath)
      }, chosen)
      // From View → Save Page As…, as Chromium's PDF viewer keeps Ctrl+S for its own Download.
      await electronApp.evaluate(({ BrowserWindow, Menu }) => {
        const item = Menu.getApplicationMenu()?.items.find(candidate => candidate.label === 'View')
          ?.submenu?.items.find(candidate => candidate.label === 'Save Page As…')
        if (!item?.click) throw new Error('Missing View → Save Page As…')
        item.click(item, BrowserWindow.getAllWindows()[0], {} as Electron.KeyboardEvent)
      })
      await expect.poll(() => existsSync(chosen) && (sent ? readFileSync(chosen).equals(sent) : readFileSync(chosen).length > 0)).toBe(true)
      const asked = await lastDialog()
      return { suggested: asked?.defaultPath?.slice(asked.defaultPath.lastIndexOf('/') + 1), filters: asked?.filters?.map(filter => filter.name) ?? [], saved: readFileSync(chosen) }
    }

    const files = [
      ['/images/pixel.png', 'saved-pixel.png', 'pixel.png'],
      ['/files/report.pdf', 'saved-report.pdf', 'report.pdf'],
      ['/api/status', 'saved-status.json', 'status.json'],
      ['/notes', 'saved-notes.txt', 'notes.txt']
    ] as const
    // A file the person chose to replace in the save dialog.
    writeFileSync(join(folder, 'saved-status.json'), 'older file')
    const saved = []
    for (const [path, name] of files) {
      const result = await save(path, name, documents[path]!.body)
      saved.push({ path, suggested: result.suggested, filters: result.filters })
    }
    // The file as the website sent it, under the name its address ends in, with no folder of files beside it, as Chrome
    // downloads it, so Downloads lists it.
    expect(saved).toEqual(files.map(([path, , suggested]) => ({ path, suggested, filters: [] })))
    expect(readdirSync(folder).sort()).toEqual(['saved-notes.txt', 'saved-pixel.png', 'saved-report.pdf', 'saved-status.json'])
    await expect.poll(async () => (await appWindow.evaluate(() => (window as DownloadsWindow).hronautDownloads.list()))
      .map(download => [download.filename, download.state]).sort())
      .toEqual([['saved-notes.txt', 'completed'], ['saved-pixel.png', 'completed'], ['saved-report.pdf', 'completed'], ['saved-status.json', 'completed']])

    // A web page is still saved as it is now, with its files.
    const page = await save('/page', 'page.html')
    expect(page.suggested).toBe('Start.html')
    expect(page.filters).toEqual(['Webpage, Complete', 'Webpage, Single File'])
    expect(page.saved.toString('utf8')).toContain('hronaut-save-marker')
    await expect.poll(() => existsSync(join(folder, 'page_files')) && readdirSync(join(folder, 'page_files'))).toEqual(['pixel.png'])
  } finally {
    await closeFixtureServer(server)
    rmSync(folder, { recursive: true, force: true })
  }
})

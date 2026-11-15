import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalizedError } from '../src/main/localized-error.js'

// Save as PDF, a recording's video and a HAR file from Hronaut's own controls failed with the folder's error when the
// download folder could not be written to, where a website's download asks where to save it, as Chrome does.

const electron = vi.hoisted(() => ({
  documents: '',
  showSaveDialog: vi.fn<(window: unknown, options: { defaultPath?: string }) => Promise<{ canceled: boolean; filePath?: string }>>(),
  windowOf: vi.fn<(page: unknown) => unknown>(() => null)
}))
vi.mock('electron', () => ({
  app: { getPath: (name: string) => { if (name !== 'documents') throw new Error(name); return electron.documents } },
  BrowserWindow: { fromWebContents: electron.windowOf },
  dialog: { showSaveDialog: electron.showSaveDialog }
}))
// The download folder's failures that a test can't cause as root, and the chosen file's.
const failures = vi.hoisted(() => ({ download: undefined as string | undefined, write: undefined as string | undefined, rename: [] as string[] }))
const fsError = (code: string) => Object.assign(new Error(`${code}: refused`), { code })
vi.mock('../src/main/browser/unique-download-file.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/browser/unique-download-file.js')>()
  return {
    ...actual,
    writeUniqueDownloadFile: async (...args: Parameters<typeof actual.writeUniqueDownloadFile>) => {
      if (failures.download) throw actual.localizedSaveFailure(fsError(failures.download))
      return actual.writeUniqueDownloadFile(...args)
    }
  }
})
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      if (failures.write) throw fsError(failures.write)
      return actual.writeFile(...args)
    },
    rename: async (...args: Parameters<typeof actual.rename>) => {
      const code = failures.rename.shift()
      if (code) throw fsError(code)
      return actual.rename(...args)
    }
  }
})
import { personExportFile } from '../src/main/browser/person-export/person-export-file.js'

let root = ''
let downloads = ''
const window = { isDestroyed: vi.fn(() => false) }
const browser = () => ({ options: { downloadDirectory: downloads }, window }) as never
const exportPdf = (validate = () => undefined) => personExportFile(browser())('page.pdf', Buffer.from('pdf'), validate)

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'hronaut-person-export-'))
  downloads = join(root, 'Downloads')
  electron.documents = join(root, 'Documents')
  Object.assign(failures, { download: undefined, write: undefined, rename: [] })
  window.isDestroyed.mockReturnValue(false)
})
afterEach(async () => {
  electron.showSaveDialog.mockReset()
  electron.windowOf.mockReset().mockReturnValue(null)
  await rm(root, { recursive: true, force: true })
})

describe('an export the person asks for in Hronaut', () => {
  it('saves a new file in the download folder without asking while it can be written to', async () => {
    const path = await exportPdf()
    expect(path).toBe(join(downloads, 'page.pdf'))
    expect(await readFile(path!, 'utf8')).toBe('pdf')
    expect(electron.showSaveDialog).not.toHaveBeenCalled()
  })

  it('asks where to save, starting in Documents, when the download folder is a file', async () => {
    await writeFile(downloads, 'not a folder')
    const chosen = join(root, 'page.pdf')
    await writeFile(chosen, 'older')
    electron.showSaveDialog.mockResolvedValue({ canceled: false, filePath: chosen })
    const path = await exportPdf()
    expect(electron.showSaveDialog).toHaveBeenCalledWith(window, expect.objectContaining({ defaultPath: join(electron.documents, 'page.pdf') }))
    // The dialog asked before replacing the file the person chose, which now holds the export, with nothing left beside it.
    expect(path).toBe(chosen)
    expect(await readFile(chosen, 'utf8')).toBe('pdf')
    expect((await readdir(root)).sort()).toEqual(['Downloads', 'page.pdf'])
  })

  it.each(['EACCES', 'EPERM', 'EROFS', 'ENOTDIR', 'ENOENT'])('asks where to save when the download folder fails with %s', async (code) => {
    failures.download = code
    electron.showSaveDialog.mockResolvedValue({ canceled: false, filePath: join(root, 'page.pdf') })
    expect(await exportPdf()).toBe(join(root, 'page.pdf'))
    expect(electron.showSaveDialog).toHaveBeenCalledOnce()
  })

  it('fails without asking when the disk is full or the page changed', async () => {
    failures.download = 'ENOSPC'
    await expect(exportPdf()).rejects.toMatchObject({ key: 'appErrors.export.saveDiskFull' })
    failures.download = undefined
    await expect(exportPdf(() => { throw new LocalizedError('appErrors.page.saveChanged') })).rejects.toMatchObject({ key: 'appErrors.page.saveChanged' })
    expect(electron.showSaveDialog).not.toHaveBeenCalled()
  })

  it('asks over the window of the page that asked, such as Page tools in its own window', async () => {
    failures.download = 'EROFS'
    const panel = { isDestroyed: () => false }
    const page = { isDestroyed: () => false }
    electron.windowOf.mockImplementation((asking) => asking === page ? panel : null)
    electron.showSaveDialog.mockResolvedValue({ canceled: true, filePath: '' })
    await personExportFile(browser(), page as never)('page.pdf', Buffer.from('pdf'), () => undefined)
    expect(electron.showSaveDialog).toHaveBeenCalledWith(panel, expect.anything())
  })

  it('saves nothing when the person cancels the dialog, or the window is gone', async () => {
    failures.download = 'EROFS'
    electron.showSaveDialog.mockResolvedValue({ canceled: true, filePath: '' })
    expect(await exportPdf()).toBeUndefined()
    window.isDestroyed.mockReturnValue(true)
    expect(await exportPdf()).toBeUndefined()
    expect(electron.showSaveDialog).toHaveBeenCalledTimes(1)
    expect(await readdir(root)).toEqual([])
  })

  it('saves nothing when the page changed while the dialog was open', async () => {
    failures.download = 'EROFS'
    let asked = false
    electron.showSaveDialog.mockImplementation(async () => { asked = true; return { canceled: false, filePath: join(root, 'page.pdf') } })
    await expect(exportPdf(() => { if (asked) throw new Error('The page changed') })).rejects.toThrow('The page changed')
    expect(await readdir(root)).toEqual([])
  })

  it('leaves no partial file behind when the chosen folder cannot take it', async () => {
    failures.download = 'EROFS'
    electron.showSaveDialog.mockResolvedValue({ canceled: false, filePath: join(root, 'gone', 'page.pdf') })
    await expect(exportPdf()).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(root)).toEqual([])
  })

  it('names the folder the person chose, not the download folder, when that one refuses the file', async () => {
    failures.download = 'EROFS'
    failures.write = 'EACCES'
    electron.showSaveDialog.mockResolvedValue({ canceled: false, filePath: join(root, 'page.pdf') })
    // MCP results and logs keep Node's message; the person reads the sentence.
    await expect(exportPdf()).rejects.toMatchObject({ key: 'appErrors.export.chosenSaveDenied', message: 'EACCES: refused', code: 'EACCES' })
  })

  it('tries the replacement again while Windows holds the new file for a moment, as Chrome does', async () => {
    failures.download = 'EROFS'
    failures.rename = ['EBUSY', 'EPERM']
    electron.showSaveDialog.mockResolvedValue({ canceled: false, filePath: join(root, 'page.pdf') })
    expect(await exportPdf()).toBe(join(root, 'page.pdf'))
    expect(await readFile(join(root, 'page.pdf'), 'utf8')).toBe('pdf')
    expect(await readdir(root)).toEqual(['page.pdf'])
  })

  it('stops trying after the third retry and leaves no partial file behind', async () => {
    failures.download = 'EROFS'
    failures.rename = ['EBUSY', 'EBUSY', 'EBUSY', 'EBUSY']
    electron.showSaveDialog.mockResolvedValue({ canceled: false, filePath: join(root, 'page.pdf') })
    await expect(exportPdf()).rejects.toMatchObject({ code: 'EBUSY' })
    expect(failures.rename).toEqual([])
    expect(await readdir(root)).toEqual([])
  })
})

describe('an agent\'s export', () => {
  it('never reaches the save dialog: no MCP tool saves through the person\'s writer', async () => {
    const tools = join(import.meta.dirname, '..', 'src', 'main', 'mcp')
    const sources = (await readdir(tools, { recursive: true })).filter(name => name.endsWith('.ts'))
    expect(sources.length).toBeGreaterThan(10)
    for (const source of sources) expect(await readFile(join(tools, source), 'utf8'), source).not.toContain('person-export')
  })
})

import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Save as PDF, a recording's video and a HAR file from Hronaut's own controls failed with the folder's error when the
// download folder could not be written to, where a website's download asks where to save it, as Chrome does.

const electron = vi.hoisted(() => ({
  documents: '',
  showSaveDialog: vi.fn<(window: unknown, options: { defaultPath?: string }) => Promise<{ canceled: boolean; filePath?: string }>>()
}))
vi.mock('electron', () => ({
  app: { getPath: (name: string) => { if (name !== 'documents') throw new Error(name); return electron.documents } },
  dialog: { showSaveDialog: electron.showSaveDialog }
}))
const folder = vi.hoisted(() => ({ writable: true }))
vi.mock('../src/main/download-folder.js', () => ({ downloadFolderWritable: () => folder.writable }))
import { personExportFile } from '../src/main/browser/person-export/person-export-file.js'

let root = ''
let downloads = ''
const window = { isDestroyed: vi.fn(() => false) }
const browser = () => ({ options: { downloadDirectory: downloads }, window }) as never

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'hronaut-person-export-'))
  downloads = join(root, 'Downloads')
  electron.documents = join(root, 'Documents')
  folder.writable = true
  window.isDestroyed.mockReturnValue(false)
})
afterEach(async () => {
  electron.showSaveDialog.mockReset()
  await rm(root, { recursive: true, force: true })
})

describe('an export the person asks for in Hronaut', () => {
  it('saves a new file in the download folder without asking while it can be written to', async () => {
    const path = await personExportFile(browser())('page.pdf', Buffer.from('pdf'), () => undefined)
    expect(path).toBe(join(downloads, 'page.pdf'))
    expect(await readFile(path!, 'utf8')).toBe('pdf')
    expect(electron.showSaveDialog).not.toHaveBeenCalled()
  })

  it('asks where to save, starting in Documents, when the download folder cannot be written to', async () => {
    folder.writable = false
    const chosen = join(root, 'page.pdf')
    await writeFile(chosen, 'older')
    electron.showSaveDialog.mockResolvedValue({ canceled: false, filePath: chosen })
    const path = await personExportFile(browser())('page.pdf', Buffer.from('pdf'), () => undefined)
    expect(electron.showSaveDialog).toHaveBeenCalledWith(window, expect.objectContaining({ defaultPath: join(electron.documents, 'page.pdf') }))
    // The dialog asked before replacing the file the person chose, which now holds the export, with nothing left beside it.
    expect(path).toBe(chosen)
    expect(await readFile(chosen, 'utf8')).toBe('pdf')
    expect((await readdir(root)).sort()).toEqual(['page.pdf'])
  })

  it('saves nothing when the person cancels the dialog, or the window is gone', async () => {
    folder.writable = false
    electron.showSaveDialog.mockResolvedValue({ canceled: true, filePath: '' })
    expect(await personExportFile(browser())('page.pdf', Buffer.from('pdf'), () => undefined)).toBeUndefined()
    window.isDestroyed.mockReturnValue(true)
    expect(await personExportFile(browser())('page.pdf', Buffer.from('pdf'), () => undefined)).toBeUndefined()
    expect(electron.showSaveDialog).toHaveBeenCalledTimes(1)
    expect(await readdir(root)).toEqual([])
  })

  it('saves nothing when the page changed while the dialog was open', async () => {
    folder.writable = false
    let asked = false
    electron.showSaveDialog.mockImplementation(async () => { asked = true; return { canceled: false, filePath: join(root, 'page.pdf') } })
    const validate = () => { if (asked) throw new Error('The page changed') }
    await expect(personExportFile(browser())('page.pdf', Buffer.from('pdf'), validate)).rejects.toThrow('The page changed')
    expect(await readdir(root)).toEqual([])
  })

  it('leaves no partial file behind when the chosen folder cannot take it', async () => {
    folder.writable = false
    electron.showSaveDialog.mockResolvedValue({ canceled: false, filePath: join(root, 'gone', 'page.pdf') })
    await expect(personExportFile(browser())('page.pdf', Buffer.from('pdf'), () => undefined)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(root)).toEqual([])
  })
})

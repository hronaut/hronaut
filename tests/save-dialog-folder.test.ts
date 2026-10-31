import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Browser } from '../src/main/browser/browser.js'
import { rememberSaveDialogFolder, saveDialogFolder } from '../src/main/browser/downloads/save-dialog-folder.js'

// The save dialog of a download, when Hronaut asks where to save, and of Save Page As always opened in the download
// folder; Chrome opens it in the folder the person last saved into.

let root = ''
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'hronaut-save-dialog-folder-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

function browserWith(last: string | null) {
  let kept = last
  const setSaveDialogDirectory = vi.fn((folder: string) => { kept = folder })
  const browser = {
    options: { downloadDirectory: join(root, 'Downloads'), getSaveDialogDirectory: () => kept, setSaveDialogDirectory }
  } as unknown as Browser
  return { browser, setSaveDialogDirectory }
}

describe('the folder a save dialog starts in', () => {
  it('is the folder the last save dialog saved into, as in Chrome', async () => {
    await mkdir(join(root, 'Projects'))
    expect(saveDialogFolder(browserWith(join(root, 'Projects')).browser)).toBe(join(root, 'Projects'))
  })

  it('is the download folder until a save dialog saved, or once that folder is gone or is not a folder', async () => {
    await writeFile(join(root, 'file'), '')
    expect(saveDialogFolder(browserWith(null).browser)).toBe(join(root, 'Downloads'))
    expect(saveDialogFolder(browserWith(join(root, 'Unplugged drive')).browser)).toBe(join(root, 'Downloads'))
    expect(saveDialogFolder(browserWith(join(root, 'file')).browser)).toBe(join(root, 'Downloads'))
    expect(saveDialogFolder(browserWith('relative').browser)).toBe(join(root, 'Downloads'))
    expect(saveDialogFolder({ options: { downloadDirectory: join(root, 'Downloads') } } as unknown as Browser)).toBe(join(root, 'Downloads'))
  })
})

describe('keeping the folder a save dialog saved into', () => {
  it('keeps the folder of the chosen file, once', () => {
    const { browser, setSaveDialogDirectory } = browserWith(null)
    rememberSaveDialogFolder(browser, join(root, 'Projects', 'report.pdf'))
    rememberSaveDialogFolder(browser, join(root, 'Projects', 'notes.txt'))
    expect(setSaveDialogDirectory.mock.calls).toEqual([[join(root, 'Projects')]])
  })

  it('keeps nothing for a path that is not absolute', () => {
    const { browser, setSaveDialogDirectory } = browserWith(null)
    rememberSaveDialogFolder(browser, 'report.pdf')
    expect(setSaveDialogDirectory).not.toHaveBeenCalled()
  })
})

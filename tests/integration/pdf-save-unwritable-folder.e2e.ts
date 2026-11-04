import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, test } from './fixtures.js'

type DialogScope = typeof globalThis & { __hronautSaveDialogs?: Electron.SaveDialogOptions[] }
type SaveScope = typeof globalThis & {
  hronaut: { savePdf: (options: { tabId: string }) => Promise<{ filename: string; path: string } | null> }
}

test('Save as PDF asks where to save when the download folder cannot be written to, as a download does', async ({ appWindow, electronApp }) => {
  const root = await mkdtemp(join(tmpdir(), 'hronaut-pdf-unwritable-'))
  try {
    const folder = join(root, 'Downloads')
    await electronApp.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog
    }, folder)
    await appWindow.evaluate('window.hronautSettings.chooseDownloadDirectory()')
    // The download folder is no folder Hronaut can save in any more, as when its drive goes away or turns read-only.
    await rm(folder, { recursive: true, force: true })
    await writeFile(folder, '')

    const chosen = join(root, 'Chosen.pdf')
    const answer = (filePath: string) => electronApp.evaluate(({ dialog }, path) => {
      const scope = globalThis as DialogScope
      scope.__hronautSaveDialogs = []
      dialog.showSaveDialog = (async (_window: unknown, options: Electron.SaveDialogOptions) => {
        scope.__hronautSaveDialogs!.push(options)
        return { canceled: path === '', filePath: path }
      }) as typeof dialog.showSaveDialog
    }, filePath)
    await answer(chosen)
    const tabId = await appWindow.evaluate(`window.hronaut.newTab({ url: 'data:text/html,<title>Unwritable PDF</title><main>Saved anyway</main>', active: true })
      .then((state) => state.tabs.find((tab) => tab.active).id)`) as string
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)'))
      .toBe('Unwritable PDF')

    const saved = await appWindow.evaluate((id) => (globalThis as SaveScope).hronaut.savePdf({ tabId: id }), tabId)
    expect(saved).toMatchObject({ filename: 'Chosen.pdf', path: chosen })
    expect((await readFile(chosen)).subarray(0, 5).toString('latin1')).toBe('%PDF-')
    const [options] = await electronApp.evaluate(() => (globalThis as DialogScope).__hronautSaveDialogs ?? [])
    const documents = await electronApp.evaluate(({ app }) => { try { return app.getPath('documents') } catch { return null } })
    expect(options?.defaultPath?.endsWith('Unwritable PDF.pdf')).toBe(true)
    if (documents) expect(dirname(options!.defaultPath!)).toBe(documents)

    // Cancelling the dialog saves nothing, and is no failure.
    await answer('')
    expect(await appWindow.evaluate((id) => (globalThis as SaveScope).hronaut.savePdf({ tabId: id }), tabId)).toBeNull()
    expect((await readdir(root)).sort()).toEqual(['Chosen.pdf', 'Downloads'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

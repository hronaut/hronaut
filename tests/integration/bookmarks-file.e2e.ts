import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { HronautBookmarksApi } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

type DialogScope = typeof globalThis & { bookmarkDialogs: Array<{ kind: string; title?: string; name?: string; extensions?: string[] }> }

test('exports bookmarks to an HTML file and imports them from one, as Chrome\'s bookmark manager does', async ({ electronApp: app, appWindow }, testInfo) => {
  const directory = testInfo.outputPath('bookmark-files')
  await mkdir(directory, { recursive: true })
  const exported = join(directory, 'exported.html')
  const chromeFile = join(directory, 'from-chrome.html')
  await appWindow.evaluate(() => (window as unknown as { hronautBookmarks: HronautBookmarksApi }).hronautBookmarks.add('https://example.test/alpha', 'Alpha reference'))
  // The system's Save and Open dialogs cannot be answered here, so they answer with these files and note what they showed.
  await app.evaluate(({ dialog }, paths) => {
    const scope = globalThis as DialogScope
    scope.bookmarkDialogs = []
    dialog.showSaveDialog = (async (_window: unknown, options: Electron.SaveDialogOptions) => {
      scope.bookmarkDialogs.push({ kind: 'save', title: options.title, name: options.defaultPath, extensions: options.filters?.[0]?.extensions })
      return { canceled: false, filePath: paths.exported }
    }) as typeof dialog.showSaveDialog
    dialog.showOpenDialog = (async (_window: unknown, options: Electron.OpenDialogOptions) => {
      scope.bookmarkDialogs.push({ kind: 'open', title: options.title, extensions: options.filters?.[0]?.extensions })
      return { canceled: false, filePaths: [paths.chromeFile] }
    }) as typeof dialog.showOpenDialog
  }, { exported, chromeFile })
  const dialogs = () => app.evaluate(() => (globalThis as DialogScope).bookmarkDialogs)

  await appWindow.getByRole('button', { name: 'New tab', exact: true }).click()
  await appWindow.getByRole('button', { name: 'Bookmarks', exact: true }).click()
  const panel = appWindow.getByRole('dialog', { name: 'Bookmarks' })
  await panel.getByRole('button', { name: 'Export…' }).click()
  await expect(panel.getByRole('status')).toHaveText('Exported 1 bookmark.')
  const html = await readFile(exported, 'utf8')
  expect(html.startsWith('<!DOCTYPE NETSCAPE-Bookmark-file-1>')).toBe(true)
  expect(html).toMatch(/<DT><A HREF="https:\/\/example\.test\/alpha" ADD_DATE="\d+" LAST_MODIFIED="\d+">Alpha reference<\/A>/)
  const [saveDialog] = await dialogs()
  expect(saveDialog).toMatchObject({ kind: 'save', title: 'Export bookmarks', extensions: ['html', 'htm'] })
  expect(basename(saveDialog!.name!)).toMatch(/^bookmarks_\d{2}_\d{2}_\d{2}\.html$/)

  // As Chrome exports them: the address already saved stays as it is, and a script link is no web page.
  await writeFile(chromeFile, `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1700000000" PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>
    <DL><p>
        <DT><A HREF="https://example.test/alpha" ADD_DATE="1700000001">Alpha from Chrome</A>
        <DT><H3 ADD_DATE="1700000002">Work</H3>
        <DL><p>
            <DT><A HREF="https://example.test/beta" ADD_DATE="1700000003">Beta &amp; more</A>
        </DL><p>
        <DT><A HREF="javascript:alert(1)" ADD_DATE="1700000004">Bookmarklet</A>
    </DL><p>
</DL><p>
`)
  await panel.getByRole('button', { name: 'Import…' }).click()
  await expect(panel.getByRole('status')).toHaveText('Imported 1 bookmark. 1 was already saved. 1 link is not a web page, so it was left out.')
  expect((await dialogs())[1]).toEqual({ kind: 'open', title: 'Import bookmarks', extensions: ['html', 'htm'] })
  await expect(panel.locator('.bookmark-item')).toHaveCount(2)
  await expect(panel).toContainText('Beta & more')
  await expect(panel).toContainText('Alpha reference')
  await expect(panel).not.toContainText('Alpha from Chrome')
  const filter = panel.getByRole('combobox', { name: 'Filter bookmarks by collection' })
  await filter.selectOption({ label: 'Work' })
  await expect(panel.locator('.bookmark-item')).toHaveCount(1)
  await expect(panel.locator('.bookmark-item')).toContainText('Beta & more')
})

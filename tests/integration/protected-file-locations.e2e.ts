import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ElectronApplication } from '@playwright/test'
import { expect, test } from './capability-fixtures.js'
import { answerTrustedDialog, trustedDialog, trustedDialogHeadline } from './trusted-dialog-fixture.js'

// A website never heard back when the person gave it a location Chromium protects, such as Hronaut's own profile or a
// whole personal folder: Electron asked Hronaut what to do and waited, and its picker or dropped folder never settled.

// A drop zone that asks for the dropped folder's handle and records how that ended.
const DROP_ZONE = `(() => {
  document.body.innerHTML = '<div id="zone" style="position:absolute;left:40px;top:40px;width:320px;height:200px">Drop a folder</div>';
  window.dropped = null;
  const zone = document.querySelector('#zone');
  zone.addEventListener('dragover', (event) => event.preventDefault());
  zone.addEventListener('drop', (event) => {
    event.preventDefault();
    window.dropped = 'waiting';
    event.dataTransfer.items[0].getAsFileSystemHandle().then(
      (handle) => { window.dropped = handle ? handle.kind + ':' + handle.name : 'none' },
      (error) => { window.dropped = error.name }
    );
  });
  return true;
})()`

/** Drops a folder on the drop zone, as a file manager does, through Chromium's input events. */
async function dropFolder(app: ElectronApplication, url: string, folder: string): Promise<void> {
  await app.evaluate(async ({ webContents }, { url, folder }) => {
    const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL() === url)!
    const attached = contents.debugger.isAttached()
    if (!attached) contents.debugger.attach('1.3')
    try {
      const data = { items: [], files: [folder], dragOperationsMask: 1 | 2 | 16 }
      for (const type of ['dragEnter', 'dragOver', 'drop']) {
        await contents.debugger.sendCommand('Input.dispatchDragEvent', { type, x: 120, y: 120, data })
      }
    } finally {
      if (!attached) contents.debugger.detach()
    }
  }, { url, folder })
}

test('tells the person a website cannot have a protected folder, and the website hears back', async ({ appWindow, capabilities, electronApp, profileDirectory }) => {
  const { fixtureUrl, fixtureOrigin } = capabilities
  const onPage = <T>(script: string): Promise<T> => electronApp.evaluate(({ webContents }, { url, script }) => (
    webContents.getAllWebContents().find((contents) => contents.getURL() === url)!.executeJavaScript(script, true)
  ), { url: fixtureUrl, script }) as Promise<T>
  // Hronaut's own profile is one of the locations Chromium protects.
  const protectedFolder = join(profileDirectory, 'protected-folder')
  await mkdir(protectedFolder, { recursive: true })
  const plainFolder = await mkdtemp(join(tmpdir(), 'hronaut-plain-folder-'))
  try {
    await onPage(DROP_ZONE)
    await dropFolder(electronApp, fixtureUrl, protectedFolder)
    const dialog = trustedDialog(appWindow)
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAttribute('data-variant', 'protected-file-access')
    expect(await trustedDialogHeadline(appWindow)).toBe(`${fixtureOrigin} can't use this folder`)
    await expect(dialog.locator('.ui-dialog__footer button')).toHaveText(['Cancel', 'Choose another folder'])
    // Cancel has the focus, so a held Enter from the picker refuses rather than reopening it.
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
    await answerTrustedDialog(appWindow, 'Choose another folder')
    // The website hears that it did not get the folder instead of waiting forever.
    await expect.poll(() => onPage('window.dropped')).toBe('AbortError')
    await expect(dialog).toHaveCount(0)

    await onPage(DROP_ZONE)
    await dropFolder(electronApp, fixtureUrl, protectedFolder)
    await answerTrustedDialog(appWindow, 'Cancel')
    await expect.poll(() => onPage('window.dropped')).toBe('AbortError')
    await expect(dialog).toHaveCount(0)

    // A folder nothing protects is given without a prompt, as before.
    await onPage(DROP_ZONE)
    await dropFolder(electronApp, fixtureUrl, plainFolder)
    await expect.poll(() => onPage('window.dropped')).toMatch(/^directory:hronaut-plain-folder-/)
    await expect(dialog).toHaveCount(0)
  } finally {
    await rm(plainFolder, { recursive: true, force: true })
  }
})

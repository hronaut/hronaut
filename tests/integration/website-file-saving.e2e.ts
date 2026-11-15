import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'
import { answerEveryTrustedDialog, answeredTrustedDialogs } from './trusted-dialog-fixture.js'

// A website's Save dialog empties the file the person picks before the website writes to it, and Hronaut then refused
// the write, so saving over a file left it empty. Saving to a file the person opened or dropped waits for their switch.

/** Records what every permission prompt said, answering each with Allow. */
const recordPrompts = (window: Page): Promise<void> => answerEveryTrustedDialog(window, 'Allow')
const prompts = (window: Page): Promise<string[]> => answeredTrustedDialogs(window)

// A drop zone that keeps the last dropped file's handle, as editors that save back to the file do.
const DROP_ZONE = `(() => {
  document.body.innerHTML = '<div id="zone" style="position:absolute;left:40px;top:40px;width:320px;height:200px">Drop a file</div>';
  window.dropped = null;
  const zone = document.querySelector('#zone');
  zone.addEventListener('dragover', (event) => event.preventDefault());
  zone.addEventListener('drop', (event) => {
    event.preventDefault();
    window.dropped = event.dataTransfer.items[0].getAsFileSystemHandle();
  });
  return true;
})()`

/** Writes `content` to the kept file as an editor saves, and says how that ended. */
const save = (content: string): string => `(async () => {
  try {
    const writable = await (await window.dropped).createWritable();
    await writable.write(${JSON.stringify(content)});
    await writable.close();
    return 'saved';
  } catch (error) {
    return error.name;
  }
})()`

test('saves to a file just emptied, as a website\'s Save dialog leaves it, and to no other file, as in Chrome', async ({ appWindow, capabilities, electronApp }) => {
  const { client, tabId, fixtureUrl } = capabilities
  const onPage = <T>(script: string): Promise<T> => electronApp.evaluate(({ webContents }, { url, script }) => (
    webContents.getAllWebContents().find((contents) => contents.getURL() === url)!.executeJavaScript(script, true)
  ), { url: fixtureUrl, script }) as Promise<T>
  const drop = async (path: string): Promise<void> => {
    await onPage(DROP_ZONE)
    const dropped = await client.callTool({ name: 'browser_file_drop', arguments: { tabId, selector: '#zone', paths: [path] } }) as CallToolResult
    expect(JSON.parse(text(dropped))).toMatchObject({ status: 'DROPPED', files: 1 })
    await expect.poll(() => onPage('window.dropped !== null')).toBe(true)
  }
  // Outside Hronaut's profile, whose files Chromium never lets a website write.
  const folder = await mkdtemp(join(tmpdir(), 'hronaut-file-saving-'))
  try {
    // Chromium empties the file the person picks in the Save dialog before handing it to the website.
    const picked = join(folder, 'picked.txt')
    await writeFile(picked, '', 'utf8')
    const notes = join(folder, 'notes.txt')
    await writeFile(notes, 'First draft', 'utf8')
    const oldEmpty = join(folder, 'old-empty.txt')
    await writeFile(oldEmpty, '', 'utf8')
    const lastYear = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
    await utimes(oldEmpty, lastYear, lastYear)
    await recordPrompts(appWindow)

    await drop(picked)
    expect(await onPage(save('Saved'))).toBe('saved')
    expect(await readFile(picked, 'utf8')).toBe('Saved')
    // The website keeps saving there once the file has content, as an editor does with Ctrl+S.
    expect(await onPage(save('Saved again'))).toBe('saved')
    expect(await readFile(picked, 'utf8')).toBe('Saved again')

    await drop(notes)
    expect(await onPage(save('Overwritten'))).toBe('NotAllowedError')
    expect(await readFile(notes, 'utf8')).toBe('First draft')
    await drop(oldEmpty)
    expect(await onPage(save('Overwritten'))).toBe('NotAllowedError')
    expect(await readFile(oldEmpty, 'utf8')).toBe('')
    expect(await prompts(appWindow)).toEqual([])
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})

test('saves to a file the person opened or dropped only while their switch is on', async ({ appWindow, capabilities, electronApp }) => {
  const { client, tabId, fixtureUrl } = capabilities
  const onPage = <T>(script: string): Promise<T> => electronApp.evaluate(({ webContents }, { url, script }) => (
    webContents.getAllWebContents().find((contents) => contents.getURL() === url)!.executeJavaScript(script, true)
  ), { url: fixtureUrl, script }) as Promise<T>
  // Outside Hronaut's profile, which Chromium protects: a rename into it asks whether the website may have that place.
  const folder = await mkdtemp(join(tmpdir(), 'hronaut-file-saving-'))
  try {
    const notes = join(folder, 'notes.txt')
    await writeFile(notes, 'First draft', 'utf8')
    const sibling = join(folder, 'sibling.txt')
    await writeFile(sibling, 'Sibling', 'utf8')
    await recordPrompts(appWindow)
    await onPage(DROP_ZONE)
    const dropped = await client.callTool({ name: 'browser_file_drop', arguments: { tabId, selector: '#zone', paths: [notes] } }) as CallToolResult
    expect(JSON.parse(text(dropped))).toMatchObject({ status: 'DROPPED', files: 1 })
    await expect.poll(() => onPage('window.dropped !== null')).toBe(true)
    expect(await onPage(save('Second draft'))).toBe('NotAllowedError')
    await appWindow.evaluate('window.hronautSettings.setAllowWebsiteFileSaving(true)')
    expect(await onPage(save('Second draft'))).toBe('saved')
    expect(await readFile(notes, 'utf8')).toBe('Second draft')
    await appWindow.evaluate('window.hronautSettings.setAllowWebsiteFileSaving(false)')
    expect(await onPage(save('Third draft'))).toBe('NotAllowedError')
    expect(await readFile(notes, 'utf8')).toBe('Second draft')
    // What the switch warns about: Electron checks a rename that replaces another file in the folder as a write to it.
    const rename = `(async () => (await window.dropped).move('sibling.txt').then(() => 'moved', (error) => error.name))()`
    expect(await onPage(rename)).toBe('NotAllowedError')
    expect(await readFile(sibling, 'utf8')).toBe('Sibling')
    await appWindow.evaluate('window.hronautSettings.setAllowWebsiteFileSaving(true)')
    expect(await onPage(rename)).toBe('moved')
    expect(await readFile(sibling, 'utf8')).toBe('Second draft')
    expect(await prompts(appWindow)).toEqual([])
  } finally {
    await appWindow.evaluate('window.hronautSettings.setAllowWebsiteFileSaving(false)')
    await rm(folder, { recursive: true, force: true })
  }
})

// A file the website held was taken for one its Save dialog gave it once it was empty for a moment, as while another
// program saves it in place, and the website then kept saving over what the person wrote there.
test('saves to a file the person dropped only while it is empty, not once it holds their text again', async ({ appWindow, capabilities, electronApp }) => {
  const { client, tabId, fixtureUrl } = capabilities
  const onPage = <T>(script: string): Promise<T> => electronApp.evaluate(({ webContents }, { url, script }) => (
    webContents.getAllWebContents().find((contents) => contents.getURL() === url)!.executeJavaScript(script, true)
  ), { url: fixtureUrl, script }) as Promise<T>
  const folder = await mkdtemp(join(tmpdir(), 'hronaut-file-saving-'))
  try {
    const notes = join(folder, 'notes.txt')
    await writeFile(notes, 'First draft', 'utf8')
    await recordPrompts(appWindow)
    await onPage(DROP_ZONE)
    const dropped = await client.callTool({ name: 'browser_file_drop', arguments: { tabId, selector: '#zone', paths: [notes] } }) as CallToolResult
    expect(JSON.parse(text(dropped))).toMatchObject({ status: 'DROPPED', files: 1 })
    await expect.poll(() => onPage('window.dropped !== null')).toBe(true)
    expect(await onPage(save('Overwritten'))).toBe('NotAllowedError')

    // Another program saves the file in place: it is empty for a moment, which loses nothing to replace.
    await writeFile(notes, '', 'utf8')
    expect(await onPage(save('Written while empty'))).toBe('saved')
    await writeFile(notes, 'Second draft, saved in another app', 'utf8')
    expect(await onPage(save('Overwritten'))).toBe('NotAllowedError')
    expect(await readFile(notes, 'utf8')).toBe('Second draft, saved in another app')
    expect(await prompts(appWindow)).toEqual([])
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})

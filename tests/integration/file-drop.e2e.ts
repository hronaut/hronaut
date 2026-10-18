import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ElectronApplication } from '@playwright/test'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'

interface DropPageState {
  events: Array<{ type: string; trusted: boolean; target: string; files: number }>
  received: Array<{ name: string; size: number; text: string }>
}

// A drop zone with no file input: it reads every dropped file and records each drag event it sees.
const DROP_PAGE = `(() => {
  document.body.innerHTML = '<div id="zone" style="position:absolute;left:40px;top:40px;width:320px;height:200px;background:#eef">Drop files here</div>';
  window.dropState = { events: [], received: [] };
  const zone = document.querySelector('#zone');
  // The document outlives each new zone, so its recorders are added once.
  if (!window.dropRecorders) {
    window.dropRecorders = true;
    for (const type of ['dragenter', 'dragover', 'dragleave', 'drop']) {
      document.addEventListener(type, (event) => {
        window.dropState.events.push({ type, trusted: event.isTrusted, target: event.target.id || event.target.tagName, files: event.dataTransfer ? event.dataTransfer.files.length : -1 });
      });
    }
  }
  window.acceptDrops = true;
  zone.addEventListener('dragover', (event) => { if (window.acceptDrops) event.preventDefault(); });
  zone.addEventListener('drop', async (event) => {
    event.preventDefault();
    for (const file of event.dataTransfer.files) window.dropState.received.push({ name: file.name, size: file.size, text: await file.text() });
  });
  return true;
})()`

async function onPage<T>(app: ElectronApplication, url: string, script: string): Promise<T> {
  return app.evaluate(async ({ webContents }, { url, script }) => {
    const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)
    if (!page) throw new Error('Missing drop fixture page')
    return page.executeJavaScript(script) as Promise<T>
  }, { url, script })
}

const pageState = (app: ElectronApplication, url: string): Promise<DropPageState> => onPage(app, url, 'window.dropState')

test('drops local files onto a drop zone without a file input, and ends a drag the target does not accept without dropping', async ({ capabilities, electronApp, appWindow, profileDirectory }) => {
  const { client, tabId, fixtureUrl } = capabilities
  const folder = join(profileDirectory, 'drop-fixtures')
  await mkdir(folder, { recursive: true })
  const notes = join(folder, 'notes.txt')
  const data = join(folder, 'data.csv')
  await writeFile(notes, 'Hronaut drop fixture: héllo 🌍\n', 'utf8')
  await writeFile(data, 'a,b\n1,2\n', 'utf8')
  await onPage(electronApp, fixtureUrl, DROP_PAGE)
  const drop = (args: Record<string, unknown>) => client.callTool({ name: 'browser_file_drop', arguments: { tabId, ...args } }) as Promise<CallToolResult>

  const one = await drop({ selector: '#zone', paths: [notes] })
  expect(one.isError, text(one)).not.toBe(true)
  expect(JSON.parse(text(one))).toMatchObject({ status: 'DROPPED', files: 1, pageHandledDrop: true })
  expect(text(one)).not.toContain(folder)
  await expect.poll(async () => (await pageState(electronApp, fixtureUrl)).received).toEqual([
    { name: 'notes.txt', size: Buffer.byteLength('Hronaut drop fixture: héllo 🌍\n'), text: 'Hronaut drop fixture: héllo 🌍\n' }
  ])
  const events = (await pageState(electronApp, fixtureUrl)).events
  expect(events.map(event => event.type)).toEqual(expect.arrayContaining(['dragenter', 'dragover', 'drop']))
  expect(events.every(event => event.trusted && event.target === 'zone')).toBe(true)
  expect(events.filter(event => event.type === 'drop')).toHaveLength(1)

  await onPage(electronApp, fixtureUrl, 'window.dropState = { events: [], received: [] }; true')
  const two = await drop({ selector: '#zone', paths: [notes, data] })
  expect(JSON.parse(text(two))).toMatchObject({ status: 'DROPPED', files: 2 })
  await expect.poll(async () => (await pageState(electronApp, fixtureUrl)).received.map(file => [file.name, file.text])).toEqual([
    ['notes.txt', 'Hronaut drop fixture: héllo 🌍\n'],
    ['data.csv', 'a,b\n1,2\n']
  ])

  // A target whose dragover handler does not accept the files gets no drop; the drag is cancelled.
  await onPage(electronApp, fixtureUrl, 'window.acceptDrops = false; window.dropState = { events: [], received: [] }; true')
  const refused = await drop({ selector: '#zone', paths: [notes] })
  expect(refused.isError, text(refused)).not.toBe(true)
  expect(JSON.parse(text(refused))).toMatchObject({ status: 'NOT_ACCEPTED', files: 1 })
  const refusedState = await pageState(electronApp, fixtureUrl)
  expect(refusedState.received).toEqual([])
  expect(refusedState.events.map(event => event.type).slice(0, 2)).toEqual(['dragenter', 'dragover'])
  expect(refusedState.events.map(event => event.type)).not.toContain('drop')
  // Chromium answers the cancel before the page handles it, so its dragleave can arrive just after the result.
  await expect.poll(async () => (await pageState(electronApp, fixtureUrl)).events.map(event => event.type)).toContain('dragleave')

  // A locked tab still takes the agent's drop, as it takes the agent's drag.
  await onPage(electronApp, fixtureUrl, 'window.acceptDrops = true; window.dropState = { events: [], received: [] }; true')
  await appWindow.evaluate(`window.hronaut.setTabHumanInteractionLocked(${JSON.stringify(tabId)}, true)`)
  try {
    const locked = await drop({ selector: '#zone', paths: [data] })
    expect(JSON.parse(text(locked)), text(locked)).toMatchObject({ status: 'DROPPED', files: 1 })
    await expect.poll(async () => (await pageState(electronApp, fixtureUrl)).received.map(file => file.name)).toEqual(['data.csv'])
    // The refused drag ended before this one: the page saw it enter again.
    expect((await pageState(electronApp, fixtureUrl)).events[0]).toMatchObject({ type: 'dragenter', target: 'zone' })
  } finally {
    await appWindow.evaluate(`window.hronaut.setTabHumanInteractionLocked(${JSON.stringify(tabId)}, false)`)
  }
})

test('refuses missing, ambiguous, hidden, covered and framed targets and unusable paths without sending files', async ({ capabilities, electronApp, profileDirectory }) => {
  const { client, tabId, fixtureUrl } = capabilities
  const folder = join(profileDirectory, 'drop-fixtures')
  await mkdir(folder, { recursive: true })
  const file = join(folder, 'notes.txt')
  await writeFile(file, 'drop fixture', 'utf8')
  await onPage(electronApp, fixtureUrl, DROP_PAGE)
  await onPage(electronApp, fixtureUrl, `
    document.body.insertAdjacentHTML('beforeend', '<div class="twin">A</div><div class="twin">B</div><div id="hidden" style="display:none">hidden</div>'
      + '<div id="covered" style="position:absolute;left:400px;top:40px;width:200px;height:120px">covered</div>'
      + '<div id="cover" style="position:absolute;left:380px;top:20px;width:260px;height:180px;background:#fee"></div>'
      + '<iframe id="frame" style="position:absolute;left:40px;top:300px;width:200px;height:120px" srcdoc="<p>frame</p>"></iframe>');
    true;
  `)
  const drop = (args: Record<string, unknown>) => client.callTool({ name: 'browser_file_drop', arguments: { tabId, ...args } }) as Promise<CallToolResult>
  const failures: Array<[Record<string, unknown>, RegExp]> = [
    [{ selector: '#nowhere', paths: [file] }, /not found/],
    [{ selector: 'div[', paths: [file] }, /not valid CSS/],
    [{ selector: '.twin', paths: [file] }, /more than one element/],
    [{ selector: '#hidden', paths: [file] }, /hidden or has no size/],
    [{ selector: '#covered', paths: [file] }, /covers the center/],
    [{ selector: '#frame', paths: [file] }, /into a frame is not supported/],
    [{ selector: '#zone', ref: 'e1', paths: [file] }, /ref or selector/i],
    [{ selector: '#zone', paths: ['relative/notes.txt'] }, /File path 1 must be absolute/],
    [{ selector: '#zone', paths: [file, folder] }, /File path 2 is not a file/],
    [{ selector: '#zone', paths: [join(folder, 'missing.txt')] }, /File path 1 cannot be read/],
    [{ selector: '#zone', paths: [file, file] }, /only once/]
  ]
  for (const [args, message] of failures) {
    const result = await drop(args)
    expect(result.isError, `${JSON.stringify(args)}: ${text(result)}`).toBe(true)
    expect(text(result)).toMatch(message)
    expect(text(result)).not.toContain(folder)
  }
  const tooMany = await drop({ selector: '#zone', paths: Array.from({ length: 21 }, (_, index) => join(folder, `${index}.txt`)) })
  expect(tooMany.isError).toBe(true)
  const state = await pageState(electronApp, fixtureUrl)
  expect(state.events).toEqual([])
  expect(state.received).toEqual([])
})

test('reports a drop the page refuses at release, follows an overlay shown on dragenter, and leaves a file input alone', async ({ capabilities, electronApp, profileDirectory }) => {
  const { client, tabId, fixtureUrl } = capabilities
  const folder = join(profileDirectory, 'drop-fixtures')
  await mkdir(folder, { recursive: true })
  const file = join(folder, 'notes.txt')
  await writeFile(file, 'drop fixture', 'utf8')
  const drop = (args: Record<string, unknown>) => client.callTool({ name: 'browser_file_drop', arguments: { tabId, ...args } }) as Promise<CallToolResult>

  // Accepts the files while they are over it, but asks for no drop effect, so Chromium ends the drag without a drop.
  await onPage(electronApp, fixtureUrl, DROP_PAGE)
  await onPage(electronApp, fixtureUrl, `
    document.querySelector('#zone').addEventListener('dragover', (event) => { event.dataTransfer.dropEffect = 'none'; });
    true;
  `)
  const refusedAtRelease = await drop({ selector: '#zone', paths: [file] })
  expect(JSON.parse(text(refusedAtRelease))).toMatchObject({ status: 'NOT_ACCEPTED', files: 1 })
  expect(JSON.parse(text(refusedAtRelease)).note).toContain('refused the drop')
  expect((await pageState(electronApp, fixtureUrl)).events.map(event => event.type)).not.toContain('drop')
  expect((await pageState(electronApp, fixtureUrl)).received).toEqual([])

  // A page-wide overlay appears on dragenter and takes the drop, as many upload pages do.
  await onPage(electronApp, fixtureUrl, `(() => {
    document.body.innerHTML = '<button id="attach" style="position:absolute;left:40px;top:40px;width:200px;height:60px">Attach</button>'
      + '<div id="overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.3)">Drop to attach</div>';
    window.dropState = { events: [], received: [] };
    const overlay = document.querySelector('#overlay');
    document.addEventListener('dragenter', (event) => { window.dropState.events.push({ type: 'dragenter', trusted: event.isTrusted, target: event.target.id, files: 0 }); overlay.style.display = 'block'; });
    overlay.addEventListener('dragover', (event) => event.preventDefault());
    overlay.addEventListener('drop', async (event) => {
      event.preventDefault();
      overlay.style.display = 'none';
      for (const file of event.dataTransfer.files) window.dropState.received.push({ name: file.name, size: file.size, text: await file.text() });
    });
    return true;
  })()`)
  // The button has a snapshot ref, so this drop names its target by ref.
  const snapshot = text(await client.callTool({ name: 'browser_snapshot', arguments: { tabId } }) as CallToolResult)
  const attachRef = /\[(e\d+)\] button[^[]*?Attach/.exec(snapshot)?.[1]
  expect(attachRef, snapshot).toBeTruthy()
  const overlay = await drop({ ref: attachRef, paths: [file] })
  expect(JSON.parse(text(overlay)), text(overlay)).toMatchObject({ status: 'DROPPED', files: 1, pageHandledDrop: true })
  await expect.poll(async () => (await pageState(electronApp, fixtureUrl)).received.map(entry => entry.text)).toEqual(['drop fixture'])

  // Chromium would set a file input's files on its own; Hronaut drops only where the page accepts.
  await onPage(electronApp, fixtureUrl, `(() => {
    document.body.innerHTML = '<input id="picker" type="file" style="position:absolute;left:40px;top:40px;width:300px;height:60px">';
    window.pickerChanges = 0;
    document.querySelector('#picker').addEventListener('change', () => { window.pickerChanges += 1; });
    return true;
  })()`)
  const input = await drop({ selector: '#picker', paths: [file] })
  expect(JSON.parse(text(input))).toMatchObject({ status: 'NOT_ACCEPTED', files: 1 })
  expect(text(input)).toContain('browser_file_upload')
  expect(await onPage(electronApp, fixtureUrl, "({ files: document.querySelector('#picker').files.length, changes: window.pickerChanges })")).toEqual({ files: 0, changes: 0 })
})

test('leaves a drag the page accepted on dragenter without dropping when no update arrives as a dragover', async ({ capabilities, electronApp, profileDirectory }) => {
  const { client, tabId, fixtureUrl } = capabilities
  const folder = join(profileDirectory, 'drop-fixtures')
  await mkdir(folder, { recursive: true })
  const file = join(folder, 'notes.txt')
  await writeFile(file, 'drop fixture', 'utf8')
  // Two tiles share one spot, one shown at a time. Every dragenter accepts the files and swaps them,
  // so each drag update reaches the page as a dragenter onto the other tile and never as a dragover:
  // Chromium's drag operation is accepted when Hronaut gives up and leaves the page. Both tiles stay
  // in the document, so a dragleave or drop sent to either one reaches the document's listeners.
  await onPage(electronApp, fixtureUrl, `(() => {
    document.body.innerHTML = '<style>.tile { position: absolute; inset: 0 } .tile[hidden] { display: none }</style>'
      + '<div id="slot" style="position:absolute;left:40px;top:40px;width:300px;height:200px"><div class="tile" id="a"></div><div class="tile" id="b" hidden></div></div>';
    window.dropState = { events: [], received: [] };
    for (const type of ['dragenter', 'dragover', 'dragleave', 'drop']) {
      document.addEventListener(type, (event) => window.dropState.events.push({ type, trusted: event.isTrusted, target: event.target.id || event.target.nodeName, files: 0 }), true);
    }
    document.addEventListener('dragenter', (event) => {
      event.preventDefault();
      for (const tile of document.querySelectorAll('.tile')) tile.hidden = !tile.hidden;
    });
    document.addEventListener('dragover', (event) => event.preventDefault());
    document.addEventListener('drop', (event) => { event.preventDefault(); window.dropState.received.push({ name: 'dropped', size: 0, text: '' }); });
    return true;
  })()`)
  const result = await client.callTool({ name: 'browser_file_drop', arguments: { tabId, selector: '#slot', paths: [file] } }) as CallToolResult
  expect(JSON.parse(text(result)), text(result)).toMatchObject({ status: 'NOT_ACCEPTED', files: 1 })
  // One dragenter for the enter and each of the four updates, a dragleave for each swap, and one more
  // dragleave when the drag leaves the page; then nothing may follow it.
  await expect.poll(async () => (await pageState(electronApp, fixtureUrl)).events.map(event => event.type)).toEqual([
    'dragenter', 'dragenter', 'dragleave', 'dragenter', 'dragleave', 'dragenter', 'dragleave', 'dragenter', 'dragleave', 'dragleave'
  ])
  await new Promise(resolve => setTimeout(resolve, 500))
  const state = await pageState(electronApp, fixtureUrl)
  expect(state.events.map(event => event.type)).not.toContain('drop')
  expect(state.events.map(event => event.type)).not.toContain('dragover')
  expect(state.received).toEqual([])
})

test('reports only what trusted drag events showed: synthetic events, a drop the page hides and a drop it does not handle', async ({ capabilities, electronApp, profileDirectory }) => {
  const { client, tabId, fixtureUrl } = capabilities
  const folder = join(profileDirectory, 'drop-fixtures')
  await mkdir(folder, { recursive: true })
  const file = join(folder, 'notes.txt')
  await writeFile(file, 'drop fixture', 'utf8')
  const drop = (args: Record<string, unknown>) => client.callTool({ name: 'browser_file_drop', arguments: { tabId, ...args } }) as Promise<CallToolResult>

  // The page never accepts a real dragover, but answers each one with a synthetic, cancelled dragover, which
  // would be the last dragover Hronaut sees if it counted synthetic events; it would then send the drop.
  await onPage(electronApp, fixtureUrl, DROP_PAGE)
  await onPage(electronApp, fixtureUrl, `(() => {
    window.acceptDrops = false;
    const zone = document.querySelector('#zone');
    zone.addEventListener('dragover', (event) => {
      if (!event.isTrusted) return;
      const fake = new DragEvent('dragover', { bubbles: true, cancelable: true });
      fake.preventDefault();
      zone.dispatchEvent(fake);
    });
    return true;
  })()`)
  const syntheticOver = await drop({ selector: '#zone', paths: [file] })
  expect(JSON.parse(text(syntheticOver)), text(syntheticOver)).toMatchObject({ status: 'NOT_ACCEPTED', files: 1 })
  expect(JSON.parse(text(syntheticOver)).note).toContain('no dragover handler')
  expect((await pageState(electronApp, fixtureUrl)).events.some(event => event.type === 'drop')).toBe(false)

  // The page accepts the dragover but refuses the drop effect, and answers Chromium's dragleave with a
  // synthetic drop, which would read as DROPPED if Hronaut counted synthetic events.
  await onPage(electronApp, fixtureUrl, DROP_PAGE)
  await onPage(electronApp, fixtureUrl, `(() => {
    const zone = document.querySelector('#zone');
    zone.addEventListener('dragover', (event) => { event.dataTransfer.dropEffect = 'none'; });
    zone.addEventListener('dragleave', (event) => {
      if (event.isTrusted) zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true }));
    });
    return true;
  })()`)
  const syntheticDrop = await drop({ selector: '#zone', paths: [file] })
  expect(JSON.parse(text(syntheticDrop)), text(syntheticDrop)).toMatchObject({ status: 'NOT_ACCEPTED', files: 1 })
  expect(JSON.parse(text(syntheticDrop)).note).toContain('refused the drop')
  expect((await pageState(electronApp, fixtureUrl)).events.filter(event => event.type === 'drop').map(event => event.trusted)).toEqual([false])

  // A capture listener the page added first stops the drop before Hronaut sees it: the files arrive, the drop is unconfirmed.
  await onPage(electronApp, fixtureUrl, DROP_PAGE)
  await onPage(electronApp, fixtureUrl, `(() => {
    window.hiddenDrop = 0;
    window.hideDrop = (event) => { event.preventDefault(); event.stopImmediatePropagation(); window.hiddenDrop = event.dataTransfer.files.length; };
    addEventListener('drop', window.hideDrop, true);
    return true;
  })()`)
  // Hronaut's own listeners are added for each drop, after the page's.
  const hidden = await drop({ selector: '#zone', paths: [file] })
  expect(JSON.parse(text(hidden)), text(hidden)).toMatchObject({ status: 'DROP_UNCONFIRMED', files: 1 })
  expect(await onPage(electronApp, fixtureUrl, 'window.hiddenDrop')).toBe(1)

  // A page that accepts the dragover but lets its drop handler skip preventDefault() still gets the drop.
  await onPage(electronApp, fixtureUrl, `(() => {
    removeEventListener('drop', window.hideDrop, true);
    document.body.innerHTML = '<div id="loose" style="position:absolute;left:40px;top:40px;width:300px;height:200px">loose</div>';
    window.looseDrops = 0;
    const loose = document.querySelector('#loose');
    loose.addEventListener('dragover', (event) => event.preventDefault());
    loose.addEventListener('drop', (event) => { window.looseDrops += event.dataTransfer.files.length; });
    return true;
  })()`)
  const loose = await drop({ selector: '#loose', paths: [file] })
  expect(JSON.parse(text(loose)), text(loose)).toMatchObject({ status: 'DROPPED', files: 1, pageHandledDrop: false })
  expect(await onPage(electronApp, fixtureUrl, 'window.looseDrops')).toBe(1)
})

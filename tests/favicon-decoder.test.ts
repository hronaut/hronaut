import { afterEach, expect, it, vi } from 'vitest'

// Icons Electron's own decoder cannot read, such as ICO and SVG on Linux, were decoded in Hronaut's window, up to eight
// at once per page, while that window drew every tab of the pages loading together.

interface FakePage {
  preferences: unknown
  loadURL: ReturnType<typeof vi.fn>
  executeJavaScript: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  isDestroyed(): boolean
  gone?: () => void
}
const fake = vi.hoisted(() => ({ pages: [] as FakePage[], answers: [] as Array<{ script: string; answer(value: unknown): void; fail(error: Error): void }> }))
vi.mock('electron', () => ({
  nativeImage: {
    createFromBuffer: (bytes: Buffer) => ({ isEmpty: () => bytes.subarray(0, 4).toString('latin1') !== '\x89PNG', source: 'native' }),
    createFromDataURL: (url: string) => ({ isEmpty: () => false, source: url })
  },
  WebContentsView: class {
    webContents: unknown
    constructor(options: { webPreferences: unknown }) {
      let destroyed = false
      const page = {
        preferences: options.webPreferences,
        loadURL: vi.fn(async () => undefined),
        executeJavaScript: vi.fn((script: string) => new Promise((answer, fail) => { fake.answers.push({ script, answer, fail }) })),
        close: vi.fn(() => { destroyed = true }),
        isDestroyed: () => destroyed,
        on: () => undefined,
        once: (name: string, listener: () => void) => { if (name === 'render-process-gone') page.gone = listener },
        setWindowOpenHandler: () => undefined
      } as FakePage & Record<string, unknown>
      fake.pages.push(page)
      this.webContents = page
    }
  }
}))
import { decodeWebsiteFavicon, FAVICON_DECODER_IDLE_MS, FaviconDecoder, MAX_FAVICON_DECODES_WAITING } from '../src/main/browser/favicon.js'

const PNG_URL = 'data:image/png;base64,AAAA'
const ICO = Buffer.from([0, 0, 1, 0, 1, 0])

afterEach(() => {
  fake.pages.length = 0
  fake.answers.length = 0
  vi.useRealTimers()
})

it('decodes an icon Electron reads itself without the decoding page', async () => {
  const decoder = { decodeImage: vi.fn() }
  expect(await decodeWebsiteFavicon(Buffer.from('\x89PNG', 'latin1'), 'image/png', decoder)).toMatchObject({ source: 'native' })
  expect(decoder.decodeImage).not.toHaveBeenCalled()
})

it('hands the decoder the signal of the page the icon is for', async () => {
  const decoder = { decodeImage: vi.fn(async () => PNG_URL) }
  const page = new AbortController()
  await decodeWebsiteFavicon(ICO, '', decoder, page.signal)
  expect(decoder.decodeImage).toHaveBeenCalledWith(`data:image/x-icon;base64,${ICO.toString('base64')}`, page.signal)
})

it('decodes an ICO icon in a page of its own, with its own empty session, and keeps only a small PNG', async () => {
  const decoder = new FaviconDecoder()
  const decoded = decodeWebsiteFavicon(ICO, 'application/octet-stream', decoder)
  await vi.waitFor(() => expect(fake.answers).toHaveLength(1))
  expect(fake.pages).toHaveLength(1)
  expect(fake.pages[0]!.preferences).toMatchObject({ partition: 'hronaut-favicon-decoder', sandbox: true, contextIsolation: true, nodeIntegration: false })
  expect(fake.pages[0]!.loadURL).toHaveBeenCalledWith('about:blank')
  expect(fake.answers[0]!.script).toContain(JSON.stringify(`data:image/x-icon;base64,${ICO.toString('base64')}`))
  fake.answers[0]!.answer(PNG_URL)
  expect(await decoded).toMatchObject({ source: PNG_URL })
  // An answer that is not a small PNG keeps the empty image Electron read.
  const refused = decodeWebsiteFavicon(ICO, '', decoder)
  await vi.waitFor(() => expect(fake.answers).toHaveLength(2))
  fake.answers[1]!.answer('data:text/html,<p>')
  expect(await refused).toMatchObject({ source: 'native' })
  decoder.dispose()
})

it('decodes one icon at a time, in one page that closes once no icon came for a while', async () => {
  vi.useFakeTimers()
  const decoder = new FaviconDecoder()
  const first = decoder.decodeImage('data:image/x-icon;base64,AQ==')
  const second = decoder.decodeImage('data:image/x-icon;base64,Ag==')
  await vi.advanceTimersByTimeAsync(0)
  expect(fake.answers).toHaveLength(1)
  fake.answers[0]!.answer(PNG_URL)
  expect(await first).toBe(PNG_URL)
  await vi.advanceTimersByTimeAsync(0)
  expect(fake.answers).toHaveLength(2)
  expect(fake.pages).toHaveLength(1)
  fake.answers[1]!.answer(null)
  expect(await second).toBeNull()

  await vi.advanceTimersByTimeAsync(FAVICON_DECODER_IDLE_MS - 1)
  expect(fake.pages[0]!.close).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(fake.pages[0]!.close).toHaveBeenCalledOnce()
  const third = decoder.decodeImage('data:image/x-icon;base64,Aw==')
  await vi.advanceTimersByTimeAsync(0)
  expect(fake.pages).toHaveLength(2)
  fake.answers[2]!.answer(PNG_URL)
  expect(await third).toBe(PNG_URL)
  decoder.dispose()
  expect(fake.pages[1]!.close).toHaveBeenCalledOnce()
})

it('replaces a decoding page that stopped working, and decodes nothing once closed with the browser', async () => {
  const decoder = new FaviconDecoder()
  const lost = decoder.decodeImage('data:image/x-icon;base64,AQ==')
  await vi.waitFor(() => expect(fake.answers).toHaveLength(1))
  fake.pages[0]!.gone!()
  fake.answers[0]!.fail(new Error('Render frame was disposed'))
  await expect(lost).rejects.toThrow('Render frame was disposed')
  const next = decoder.decodeImage('data:image/x-icon;base64,Ag==')
  await vi.waitFor(() => expect(fake.answers).toHaveLength(2))
  expect(fake.pages).toHaveLength(2)
  fake.answers[1]!.answer(PNG_URL)
  expect(await next).toBe(PNG_URL)
  decoder.dispose()
  expect(await decoder.decodeImage('data:image/x-icon;base64,Aw==')).toBeNull()
  expect(fake.pages).toHaveLength(2)
})

it('skips the icons of a page that went on before their turn, and decodes none past the icons waiting already', async () => {
  // A page's eight icon candidates waited for the decoding page after one of them was shown, and the icons of 45 pages
  // loading together could wait without end.
  const decoder = new FaviconDecoder()
  const first = decoder.decodeImage('data:image/x-icon;base64,AQ==')
  const page = new AbortController()
  const skipped = decoder.decodeImage('data:image/x-icon;base64,Ag==', page.signal)
  const waiting = Array.from({ length: MAX_FAVICON_DECODES_WAITING - 2 }, () => decoder.decodeImage('data:image/x-icon;base64,Aw=='))
  expect(await decoder.decodeImage('data:image/x-icon;base64,BA==')).toBeNull()
  page.abort()
  await vi.waitFor(() => expect(fake.answers).toHaveLength(1))
  fake.answers[0]!.answer(PNG_URL)
  expect(await first).toBe(PNG_URL)
  expect(await skipped).toBeNull()
  await vi.waitFor(() => expect(fake.answers).toHaveLength(2))
  expect(fake.answers[1]!.script).toContain('Aw==')
  decoder.dispose()
  fake.answers[1]!.answer(PNG_URL)
  expect(await Promise.all(waiting)).toEqual([PNG_URL, ...Array(MAX_FAVICON_DECODES_WAITING - 3).fill(null)])
})

import { afterEach, describe, expect, it, vi } from 'vitest'

const clipboard = vi.hoisted(() => ({ readText: vi.fn(async () => '') }))
vi.mock('electron', () => ({ clipboard }))

const { addressPasteAndGo } = await import('../src/main/windows/address-paste-and-go.js')
const { addressPasteText, pastesJavascriptScheme } = await import('../src/shared/address-paste.js')

afterEach(() => { clipboard.readText.mockReset(); clipboard.readText.mockResolvedValue('') })

function shellWindow(options: { focusedAddressBar?: boolean | Error; destroyed?: () => boolean } = {}) {
  const focused = options.focusedAddressBar ?? true
  return {
    isDestroyed: options.destroyed ?? (() => false),
    webContents: {
      executeJavaScript: vi.fn(async () => {
        if (focused instanceof Error) throw focused
        return focused
      }),
      send: vi.fn()
    }
  }
}

describe('text pasted into the address bar', () => {
  it('reads as Chrome\'s address bar reads a paste', () => {
    expect(addressPasteText('  example.com  ')).toBe('example.com')
    // An address split over lines reads whole.
    expect(addressPasteText('https://example.com/a\n  /b?c=1\r\n&d=2')).toBe('https://example.com/a/b?c=1&d=2')
    // Lines of words keep a space between them, and spaces without a line break stay as they are (Chrome's own cases).
    expect(addressPasteText('1600 Amphitheatre Parkway\nMountain View, CA')).toBe('1600 Amphitheatre Parkway Mountain View, CA')
    expect(addressPasteText('TypeError: x is undefined\n    at main (app.js:1:2)\n')).toBe('TypeError: x is undefined at main (app.js:1:2)')
    expect(addressPasteText('hronaut   browser\tfor\u00a0agents')).toBe('hronaut   browser\tfor\u00a0agents')
    expect(addressPasteText('http://foo.com/a.  b')).toBe('http://foo.com/a.  b')
    expect(addressPasteText(' \n\t ')).toBe('')
  })

  it('drops every leading javascript: scheme, so pasted script never runs from the address bar', () => {
    expect(addressPasteText('javascript:alert(1)')).toBe('alert(1)')
    expect(addressPasteText('  JavaScript: javascript:alert(document.cookie)')).toBe('alert(document.cookie)')
    expect(addressPasteText('java\nscript:alert(1)')).toBe('alert(1)')
    expect(addressPasteText('java\r\nscript: alert(0)')).toBe('java script: alert(0)')
    expect(addressPasteText('\u0001javascript:alert(1)')).toBe('alert(1)')
    // Text without the scheme keeps what it starts with, and the scheme later in the text is the page's business.
    expect(addressPasteText('https://example.com/?next=javascript:void(0)')).toBe('https://example.com/?next=javascript:void(0)')
    expect(addressPasteText('javascripts:are fun')).toBe('javascripts:are fun')
  })

  it('tells whether the text starts with the javascript: scheme it drops', () => {
    for (const text of ['javascript:alert(1)', '  JavaScript: javascript:alert(1)', 'java\nscript:alert(1)', '\u0001javascript:alert(1)', 'javascript:']) {
      expect(pastesJavascriptScheme(text), text).toBe(true)
    }
    for (const text of ['https://example.com/?next=javascript:void(0)', 'javascripts:are fun', 'java\r\nscript: alert(0)', 'example.com', '']) {
      expect(pastesJavascriptScheme(text), text).toBe(false)
    }
  })
})

describe('Paste and Go in the address bar\'s menu', () => {
  it('offers Paste and Go to the address and sends the text the menu opened with', async () => {
    clipboard.readText.mockResolvedValue('  example.com/docs\n  /start ')
    const window = shellWindow()
    const item = await addressPasteAndGo(window as never)

    expect(item).toMatchObject({ label: 'native.context.pasteAndGoTo', parameters: { text: 'example.com/docs/start' } })
    clipboard.readText.mockResolvedValue('changed.example')
    item?.go?.()
    expect(window.webContents.send).toHaveBeenCalledExactlyOnceWith('browser:address-paste-and-go', 'example.com/docs/start')
  })

  it('offers Paste and Search for text that is no address, and for script with its scheme dropped', async () => {
    clipboard.readText.mockResolvedValue('hronaut & browser')
    // The label shows an ampersand rather than taking it as an access key.
    expect(await addressPasteAndGo(shellWindow() as never)).toMatchObject({ label: 'native.context.pasteAndSearchFor', parameters: { text: 'hronaut && browser' } })
    clipboard.readText.mockResolvedValue(`find ${'word '.repeat(20)}`)
    expect((await addressPasteAndGo(shellWindow() as never))?.parameters?.text).toBe(`find ${'word '.repeat(8)}word…`)

    clipboard.readText.mockResolvedValue('javascript:alert(1)')
    const window = shellWindow()
    const item = await addressPasteAndGo(window as never)
    expect(item).toMatchObject({ label: 'native.context.pasteAndSearchFor', parameters: { text: 'alert(1)' } })
    item?.go?.()
    expect(window.webContents.send).toHaveBeenCalledExactlyOnceWith('browser:address-paste-and-go', 'alert(1)')
  })

  it('shows Paste and Go disabled, as Chrome does, when the clipboard holds nothing to open', async () => {
    for (const text of ['', ' \n ', 'javascript:', 'a'.repeat(2 * 1024 * 1024 + 1)]) {
      clipboard.readText.mockResolvedValue(text)
      expect(await addressPasteAndGo(shellWindow() as never), text.slice(0, 20)).toEqual({ label: 'native.context.pasteAndGo' })
    }
    clipboard.readText.mockRejectedValue(new Error('clipboard unavailable'))
    expect(await addressPasteAndGo(shellWindow() as never)).toEqual({ label: 'native.context.pasteAndGo' })
  })

  it('offers nothing outside the address bar, or when the window cannot say where the click was', async () => {
    clipboard.readText.mockResolvedValue('example.com')
    const window = shellWindow({ focusedAddressBar: false })
    expect(await addressPasteAndGo(window as never)).toBeUndefined()
    expect(window.webContents.executeJavaScript).toHaveBeenCalledExactlyOnceWith('document.activeElement?.matches?.(\'input.address[role="combobox"]\') === true')
    expect(await addressPasteAndGo(shellWindow({ focusedAddressBar: new Error('render frame was disposed') }) as never)).toBeUndefined()
    expect(clipboard.readText).not.toHaveBeenCalled()
  })

  it('sends nothing once the window has closed', async () => {
    clipboard.readText.mockResolvedValue('example.com')
    let destroyed = false
    const window = shellWindow({ destroyed: () => destroyed })
    const item = await addressPasteAndGo(window as never)
    destroyed = true
    item?.go?.()
    expect(window.webContents.send).not.toHaveBeenCalled()
  })
})

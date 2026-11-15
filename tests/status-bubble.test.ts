import { describe, expect, it } from 'vitest'
import { parseStatusBubbleMeasurement, statusBubbleText, STATUS_BUBBLE_TEXT_LIMIT } from '../src/shared/status-bubble.js'

// Pointing at a link showed nothing of where it goes. Chrome shows its address at the page's bottom left corner,
// written as its status bubble writes it.

describe('how the status bubble writes a link\'s address', () => {
  it('leaves out http://, a user name and password, and the slash after a bare host, as Chrome does', () => {
    expect(statusBubbleText('https://github.com/hronaut/hronaut?tab=readme#install')).toEqual({ scheme: 'https://', host: 'github.com', rest: '/hronaut/hronaut?tab=readme#install' })
    expect(statusBubbleText('http://localhost:5173/app')).toEqual({ scheme: '', host: 'localhost:5173', rest: '/app' })
    expect(statusBubbleText('https://example.com/')).toEqual({ scheme: 'https://', host: 'example.com', rest: '' })
    expect(statusBubbleText('https://user:secret@example.com/private')).toEqual({ scheme: 'https://', host: 'example.com', rest: '/private' })
    expect(statusBubbleText('http://[::1]:3000/')).toEqual({ scheme: '', host: '[::1]:3000', rest: '' })
    // A host that starts with ftp. keeps http://, which it would otherwise read as another scheme.
    expect(statusBubbleText('http://ftp.example.com/file')).toEqual({ scheme: 'http://', host: 'ftp.example.com', rest: '/file' })
  })

  it('writes escaped spaces as spaces and leaves everything else escaped', () => {
    expect(statusBubbleText('https://example.com/my%20file%2Fname.pdf?q=a%20b')?.rest).toBe('/my file%2Fname.pdf?q=a b')
    // An address keeps its punycode host, as the address bar shows it.
    expect(statusBubbleText('https://xn--e1afmkfd.xn--p1ai/')?.host).toBe('xn--e1afmkfd.xn--p1ai')
  })

  it('writes an address with no host whole, and a file with its path', () => {
    expect(statusBubbleText('mailto:team@example.com')).toEqual({ scheme: '', host: '', rest: 'mailto:team@example.com' })
    expect(statusBubbleText('javascript:void(0)')).toEqual({ scheme: '', host: '', rest: 'javascript:void(0)' })
    expect(statusBubbleText('file:///home/me/notes.html')).toEqual({ scheme: 'file://', host: '', rest: '/home/me/notes.html' })
  })

  it('takes the bubble away for no address, and keeps a long one within the limit', () => {
    expect(statusBubbleText('')).toBeUndefined()
    const long = statusBubbleText(`data:text/plain,${'a'.repeat(10_000)}`)!
    expect(long.rest).toHaveLength(STATUS_BUBBLE_TEXT_LIMIT)
    // A cut never ends halfway through a character.
    const emoji = statusBubbleText(`https://example.com/${'%F0%9F%98%80'.repeat(2_000)}`)!
    expect(emoji.rest.length).toBeLessThanOrEqual(STATUS_BUBBLE_TEXT_LIMIT)
    expect(statusBubbleText(`${'x'.repeat(STATUS_BUBBLE_TEXT_LIMIT - 1)}\u{1F600}`)?.rest).toBe('x'.repeat(STATUS_BUBBLE_TEXT_LIMIT - 1))
    expect(statusBubbleText(`https://${'a'.repeat(10_000)}.example/`)?.host).toHaveLength(STATUS_BUBBLE_TEXT_LIMIT)
  })
})

describe('the status bubble view\'s measurement', () => {
  it('takes a size and whether the address was shortened, and nothing else', () => {
    expect(parseStatusBubbleMeasurement({ id: 3, width: 120, height: 22, shortened: false })).toEqual({ id: 3, width: 120, height: 22, shortened: false })
    for (const value of [null, [], { id: 0, width: 1, height: 1, shortened: false }, { id: 1, width: 0, height: 1, shortened: false }, { id: 1, width: 1, height: Infinity, shortened: false }, { id: 1, width: 1, height: 1 }, { id: 1.5, width: 1, height: 1, shortened: true }]) {
      expect(parseStatusBubbleMeasurement(value)).toBeUndefined()
    }
  })
})

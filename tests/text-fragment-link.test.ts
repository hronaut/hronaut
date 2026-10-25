import { describe, expect, it } from 'vitest'
import { textFragmentLink } from '../src/main/browser/context-menus/text-fragment-link.js'

// The page's context menu had no Copy link to highlight, as Chrome's has: the link that scrolls to the selected text
// and highlights it when it is opened.

const PAGE = 'https://docs.example/guide?step=2'

describe('the link to a highlight', () => {
  it('quotes a short selection whole, escaped, with its spaces made single', () => {
    expect(textFragmentLink(PAGE, 'Hronaut   agent\tbrowser')).toBe('https://docs.example/guide?step=2#:~:text=Hronaut%20agent%20browser')
    // A dash marks the text around a match, and a comma or an ampersand the parts of a directive, so each is escaped.
    expect(textFragmentLink(PAGE, 'state-of-the-art, fast & small')).toBe('https://docs.example/guide?step=2#:~:text=state%2Dof%2Dthe%2Dart%2C%20fast%20%26%20small')
    expect(textFragmentLink(PAGE, ' caf\u00e9 \u65e5\u672c ')).toBe('https://docs.example/guide?step=2#:~:text=caf%C3%A9%20%E6%97%A5%E6%9C%AC')
  })

  it('marks a longer selection by its first and last words', () => {
    const words = Array.from({ length: 80 }, (_, index) => `word${index}`)
    const text = words.join(' ')
    expect(text.length).toBeGreaterThan(300)
    expect(textFragmentLink(PAGE, text)).toBe('https://docs.example/guide?step=2#:~:text=word0%20word1%20word2%20word3%20word4,word75%20word76%20word77%20word78%20word79')
    // Exactly 300 characters are still quoted whole.
    const quoted = 'a'.repeat(300)
    expect(textFragmentLink(PAGE, quoted)).toBe(`https://docs.example/guide?step=2#:~:text=${quoted}`)
  })

  it('marks a selection across paragraphs by its first and last paragraph, however short', () => {
    expect(textFragmentLink(PAGE, 'First para one\n\nSecond para two\n\nitem a')).toBe('https://docs.example/guide?step=2#:~:text=First%20para%20one,item%20a')
    expect(textFragmentLink(PAGE, '\n  Lead  \n\n\n tail end \n')).toBe('https://docs.example/guide?step=2#:~:text=Lead,tail%20end')
  })

  it('never cuts a word, and quotes whole a long text with too few words to mark by its ends', () => {
    const long = `https://example.test/${'x'.repeat(150)}`
    const words = [long, 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', long].join(' ')
    expect(textFragmentLink(PAGE, words)).toBe(`https://docs.example/guide?step=2#:~:text=${encodeURIComponent(long)},${encodeURIComponent(long)}`)
    // Words that stop fitting are left out rather than cut.
    const wide = ['a'.repeat(60), 'b'.repeat(30), 'c'.repeat(30), ...Array.from({ length: 20 }, () => 'mid'), 'd'.repeat(30), 'e'.repeat(30), 'f'.repeat(60)].join(' ')
    expect(textFragmentLink(PAGE, wide)).toBe(`https://docs.example/guide?step=2#:~:text=${'a'.repeat(60)}%20${'b'.repeat(30)},${'e'.repeat(30)}%20${'f'.repeat(60)}`)
    const unspaced = '\u65e5'.repeat(400)
    expect(textFragmentLink(PAGE, unspaced)).toBe(`https://docs.example/guide?step=2#:~:text=${encodeURIComponent(unspaced)}`)
  })

  it('keeps the page\'s own fragment, and puts the new text in place of a text fragment it had', () => {
    expect(textFragmentLink('https://docs.example/guide#install', 'npm ci')).toBe('https://docs.example/guide#install:~:text=npm%20ci')
    expect(textFragmentLink('https://docs.example/guide#install:~:text=old', 'npm ci')).toBe('https://docs.example/guide#install:~:text=npm%20ci')
    expect(textFragmentLink('https://docs.example/guide#:~:text=old&text=older', 'npm ci')).toBe('https://docs.example/guide#:~:text=npm%20ci')
    expect(textFragmentLink('http://127.0.0.1:3000/', 'local')).toBe('http://127.0.0.1:3000/#:~:text=local')
  })

  it('links to half a character as U+FFFD, as Chrome reads it, rather than failing', () => {
    expect(textFragmentLink(PAGE, 'agents \uD800')).toBe('https://docs.example/guide?step=2#:~:text=agents%20%EF%BF%BD')
  })

  it('makes no link longer than Chromium opens', () => {
    // A selection of a long text written without spaces is quoted whole.
    expect(textFragmentLink(PAGE, 'a'.repeat(2 * 1024 * 1024))).toBeUndefined()
    expect(textFragmentLink(PAGE, 'a'.repeat(1024 * 1024))).toHaveLength(PAGE.length + ':~:text='.length + 1 + 1024 * 1024)
  })

  it('makes no link for a page that is not a web page, or a selection of only spaces', () => {
    for (const url of ['hronaut://home/', 'about:blank', 'file:///home/me/notes.html', 'data:text/html,hi', 'not an address']) {
      expect(textFragmentLink(url, 'text'), url).toBeUndefined()
    }
    expect(textFragmentLink(PAGE, ' \n\t\n ')).toBeUndefined()
    expect(textFragmentLink(PAGE, '')).toBeUndefined()
  })
})

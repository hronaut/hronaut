import { describe, expect, it } from 'vitest'
import { textFragmentLink, type HighlightPageText } from '../src/main/browser/context-menus/text-fragment-link.js'

// The page's context menu had no Copy link to highlight, as Chrome's has: the link that scrolls to the selected text
// and highlights it when it is opened.

const PAGE = 'https://docs.example/guide?step=2'
const LINK = `${PAGE}#:~:text=`

function selected(runs: string[], start: [number, number], end: [number, number]): HighlightPageText {
  return { runs, start: { run: start[0], offset: start[1] }, end: { run: end[0], offset: end[1] } }
}

describe('the link to a highlight, from the menu\'s selected text', () => {
  it('quotes a short selection whole, escaped, with its spaces as the page shows them', () => {
    expect(textFragmentLink(PAGE, ' Hronaut agent browser ')).toBe(`${LINK}Hronaut%20agent%20browser`)
    // Chromium matches the spaces of preformatted text one for one.
    expect(textFragmentLink(PAGE, 'x   = 1')).toBe(`${LINK}x%20%20%20%3D%201`)
    // A dash marks the text around a match, and a comma or an ampersand the parts of a directive, so each is escaped.
    expect(textFragmentLink(PAGE, 'state-of-the-art, fast & small')).toBe(`${LINK}state%2Dof%2Dthe%2Dart%2C%20fast%20%26%20small`)
    expect(textFragmentLink(PAGE, ' caf\u00E9 \u65E5\u672C ')).toBe(`${LINK}caf%C3%A9%20%E6%97%A5%E6%9C%AC`)
  })

  it('marks a longer selection by its first and last words', () => {
    const words = Array.from({ length: 80 }, (_, index) => `word${index}`)
    const text = words.join(' ')
    expect(text.length).toBeGreaterThan(300)
    expect(textFragmentLink(PAGE, text)).toBe(`${LINK}word0%20word1%20word2%20word3%20word4,word75%20word76%20word77%20word78%20word79`)
    // Exactly 300 characters are still quoted whole.
    const quoted = 'a'.repeat(300)
    expect(textFragmentLink(PAGE, quoted)).toBe(`${LINK}${quoted}`)
  })

  it('marks a selection across lines or table cells by its first and last, however short', () => {
    expect(textFragmentLink(PAGE, 'First para one\n\nSecond para two\n\nitem a')).toBe(`${LINK}First%20para%20one,item%20a`)
    expect(textFragmentLink(PAGE, '\n  Lead  \n\n\n tail end \n')).toBe(`${LINK}Lead,tail%20end`)
    // The menu separates table cells with a tab, and a match does not cross from one cell to the next.
    expect(textFragmentLink(PAGE, '\nPrice\tTotal\n')).toBe(`${LINK}Price,Total`)
  })

  it('never cuts a word, and quotes whole a long text with too few words to mark by its ends', () => {
    const long = 'x'.repeat(320)
    const words = [long, 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', long].join(' ')
    expect(textFragmentLink(PAGE, words)).toBe(`${LINK}${encodeURIComponent(long)},${encodeURIComponent(long)}`)
    // Words that stop fitting are left out rather than cut.
    const wide = ['a'.repeat(60), 'b'.repeat(30), 'c'.repeat(30), ...Array.from({ length: 20 }, () => 'mid'), 'd'.repeat(30), 'e'.repeat(30), 'f'.repeat(60)].join(' ')
    expect(textFragmentLink(PAGE, wide)).toBe(`${LINK}${'a'.repeat(60)}%20${'b'.repeat(30)},${'e'.repeat(30)}%20${'f'.repeat(60)}`)
    const unspaced = '\u65E5'.repeat(400)
    // Text written without spaces has words too, so a long one is marked by its ends rather than quoted whole.
    expect(textFragmentLink(PAGE, unspaced)).toBe(`${LINK}${encodeURIComponent('\u65E5'.repeat(5))},${encodeURIComponent('\u65E5'.repeat(5))}`)
  })

  it('keeps the page\'s own fragment and other directives, and puts the new text in place of a text directive it had', () => {
    expect(textFragmentLink('https://docs.example/guide#install', 'npm ci')).toBe('https://docs.example/guide#install:~:text=npm%20ci')
    expect(textFragmentLink('https://docs.example/guide#install:~:text=old', 'npm ci')).toBe('https://docs.example/guide#install:~:text=npm%20ci')
    expect(textFragmentLink('https://docs.example/guide#:~:text=old&text=older', 'npm ci')).toBe('https://docs.example/guide#:~:text=npm%20ci')
    expect(textFragmentLink('https://docs.example/guide#s:~:note=1&text=old', 'npm ci')).toBe('https://docs.example/guide#s:~:note=1&text=npm%20ci')
    expect(textFragmentLink('http://127.0.0.1:3000/', 'local')).toBe('http://127.0.0.1:3000/#:~:text=local')
  })

  it('leaves a sign-in in the page\'s address out of the link', () => {
    expect(textFragmentLink('https://me:secret@docs.example/guide', 'npm ci')).toBe('https://docs.example/guide#:~:text=npm%20ci')
  })

  it('links to half a character as U+FFFD, as Chrome reads it, rather than failing', () => {
    expect(textFragmentLink(PAGE, 'agents \uD800')).toBe(`${LINK}agents%20%EF%BF%BD`)
  })

  it('makes no link longer than Chromium opens', () => {
    // A selection of a long text written without spaces is quoted whole.
    expect(textFragmentLink(PAGE, 'a'.repeat(2 * 1024 * 1024))).toBeUndefined()
    expect(textFragmentLink(PAGE, 'a'.repeat(1024 * 1024))).toHaveLength(LINK.length + 1024 * 1024)
  })

  it('makes no link for a page that is not a web page, or a selection of only spaces', () => {
    for (const url of ['hronaut://home/', 'about:blank', 'file:///home/me/notes.html', 'data:text/html,hi', 'not an address']) {
      expect(textFragmentLink(url, 'text'), url).toBeUndefined()
    }
    expect(textFragmentLink(PAGE, ' \n\t\n ')).toBeUndefined()
    expect(textFragmentLink(PAGE, '')).toBeUndefined()
  })
})

describe('the link to a highlight, from the page\'s text', () => {
  it('grows a selection that starts or ends inside a word to the whole word, as a match takes whole words', () => {
    expect(textFragmentLink(PAGE, selected(['Highlight the text here'], [0, 1], [0, 15]))).toBe(`${LINK}Highlight%20the%20text`)
    // Words are found as Chromium finds them, also in text written without spaces.
    expect(textFragmentLink(PAGE, selected(['\u65E5\u672C\u8A9E\u306E\u6587'], [0, 1], [0, 2]))).toBe(`${LINK}%E6%97%A5%E6%9C%AC%E8%AA%9E`)
    // Spaces at either end are left out, and a selection that only reaches the end of a run starts in the next.
    expect(textFragmentLink(PAGE, selected(['Lead in', 'Body text'], [0, 7], [1, 9]))).toBe(`${LINK}Body%20text`)
  })

  it('marks a selection across runs, such as an inline block, by its first and last', () => {
    expect(textFragmentLink(PAGE, selected(['Alpha', 'Beta', 'Gamma'], [0, 0], [2, 5]))).toBe(`${LINK}Alpha,Gamma`)
    expect(textFragmentLink(PAGE, selected(['x   = 1'], [0, 0], [0, 7]))).toBe(`${LINK}x%20%20%20%3D%201`)
  })

  it('adds the words around text the page holds more than once, until the link finds only it', () => {
    expect(textFragmentLink(PAGE, selected(['Pick the word apple first.', 'Then the word apple again.'], [1, 5], [1, 19])))
      .toBe(`${LINK}Then-,the%20word%20apple,-again`)
    // A match is case-insensitive, so one word around it is not enough here.
    expect(textFragmentLink(PAGE, selected(['Then the word apple again.', 'And then the word apple again.'], [1, 9], [1, 23])))
      .toBe(`${LINK}And%20then-,the%20word%20apple,-again`)
    // Chromium matches a no-break space to a space.
    expect(textFragmentLink(PAGE, selected(['Say one\u00A0two now', 'Then one two'], [1, 5], [1, 12]))).toBe(`${LINK}Then-,one%20two`)
    // Before a range, the words go before its start, which is where the page looks for it first, and none after its end.
    expect(textFragmentLink(PAGE, selected(['Agents get their own browser.', 'Note: Agents get their own browser.', 'Every project keeps its sign-ins apart. Always.'], [1, 6], [2, 39])))
      .toBe(`${LINK}Note%3A-,Agents%20get%20their%20own%20browser,keeps%20its%20sign%2Dins%20apart.`)
  })

  it('counts copies as Chromium finds them, alike but for accents and with words around them across runs', () => {
    expect(textFragmentLink(PAGE, selected(['Resume tips here', 'R\u00E9sum\u00E9 tips here'], [1, 0], [1, 11]))).toBe(`${LINK}here-,R%C3%A9sum%C3%A9%20tips,-here`)
    expect(textFragmentLink(PAGE, selected(['Then', 'the word apple again', 'Then the word apple again now'], [2, 5], [2, 19])))
      .toBe(`${LINK}Then-,the%20word%20apple,-again%20now`)
  })

  it('grows a selection to a whole word however long the word is', () => {
    expect(textFragmentLink(PAGE, selected([`${'y'.repeat(100)} end`], [0, 80], [0, 104]))).toBe(`${LINK}${'y'.repeat(100)}%20end`)
  })

  it('adds nothing to text found only once as whole words, and takes the words around text that fills its run from the runs beside it', () => {
    expect(textFragmentLink(PAGE, selected(['apples and pineapple', 'Eat apple now'], [1, 4], [1, 9]))).toBe(`${LINK}apple`)
    expect(textFragmentLink(PAGE, selected(['the word apple', 'the word apple'], [1, 0], [1, 14]))).toBe(`${LINK}apple-,the%20word%20apple`)
  })

  it('makes no link from a place outside the page\'s text', () => {
    expect(textFragmentLink(PAGE, selected(['text'], [3, 0], [3, 2]))).toBeUndefined()
    expect(textFragmentLink(PAGE, selected(['   '], [0, 0], [0, 3]))).toBeUndefined()
  })
})

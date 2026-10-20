import { describe, expect, it } from 'vitest'
import { SavedLinkNames, savedLinkFilename } from '../src/main/browser/saved-link-names.js'

describe('the name of a Save Link As download', () => {
  it.each([
    ['report.csv', 'export.csv', '', 'report.csv'],
    ['report.csv', 'export.csv', 'inline', 'report.csv'],
    ['report.csv', 'server.csv', 'attachment; filename="server.csv"', 'server.csv'],
    ['report.csv', 'résumé.pdf', "attachment;filename*=UTF-8''r%C3%A9sum%C3%A9.pdf", 'résumé.pdf'],
    // A name without an extension takes the one Chromium chose for the response, as Chrome adds the type's.
    ['quarterly', 'export.csv', '', 'quarterly.csv'],
    ['quarterly', 'export', '', 'quarterly'],
    // A name never reaches outside the downloads folder, hides the file or turns its extension around.
    ['../../.bashrc', 'export.txt', '', '_.._.bashrc'],
    ['..hidden.txt', 'export.txt', '', 'hidden.txt'],
    ['  notes.txt. ', 'export.txt', '', 'notes.txt'],
    ['a:b*c?"d"<e>|f~g.txt', 'export.txt', '', 'a_b_c__d__e__f_g.txt'],
    ['invoice‮fdp.exe', 'export.txt', '', 'invoice_fdp.exe'],
    ['line\nbreak.txt', 'export.txt', '', 'line_break.txt'],
    // Nothing usable is left.
    ['...', 'export.csv', '', 'export.csv'],
    ['/', 'export.csv', '', 'export.csv'],
    ['​', 'export.csv', '', 'export.csv']
  ])('names %j with Chromium name %j and disposition %j as %j', (linkName, chromiumName, disposition, expected) => {
    expect(savedLinkFilename(linkName, chromiumName, disposition)).toBe(expected)
  })
})

describe('names waiting for their Save Link As download', () => {
  it('gives each name to the first download of its address from its page, ignoring the fragment', () => {
    const names = new SavedLinkNames()
    names.expect(1, 'https://files.example/a?id=1', 'first.csv')
    names.expect(1, 'https://files.example/a?id=1#again', 'second.csv')
    names.expect(1, 'https://files.example/b', 'other.csv')
    expect(names.take(2, 'https://files.example/a?id=1')).toBeUndefined()
    expect(names.take(undefined, 'https://files.example/a?id=1')).toBeUndefined()
    expect(names.take(1, 'https://files.example/a?id=2')).toBeUndefined()
    expect(names.take(1, 'https://files.example/a?id=1#x')).toBe('first.csv')
    expect(names.take(1, 'https://files.example/a?id=1')).toBe('second.csv')
    expect(names.take(1, 'https://files.example/a?id=1')).toBeUndefined()
    expect(names.take(1, 'https://files.example/b')).toBe('other.csv')
  })

  it('forgets a name whose download never started within five minutes, and keeps at most 16 per page', () => {
    let now = 0
    const names = new SavedLinkNames(() => now)
    names.expect(1, 'https://files.example/slow', 'slow.csv')
    names.expect(3, 'https://files.example/gone', 'gone.csv')
    now = 5 * 60_000 - 1
    expect(names.take(1, 'https://files.example/slow')).toBe('slow.csv')
    names.expect(1, 'https://files.example/late', 'late.csv')
    now += 5 * 60_000
    expect(names.take(1, 'https://files.example/late')).toBeUndefined()
    expect(names.take(3, 'https://files.example/gone')).toBeUndefined()
    for (let index = 0; index < 20; index += 1) names.expect(2, `https://files.example/${index}`, `${index}.csv`)
    expect(names.take(2, 'https://files.example/3')).toBeUndefined()
    expect(names.take(2, 'https://files.example/4')).toBe('4.csv')
    expect(names.take(2, 'https://files.example/19')).toBe('19.csv')
  })

  it('ignores an empty name and forgets everything when cleared', () => {
    const names = new SavedLinkNames()
    names.expect(1, 'https://files.example/a', '')
    expect(names.take(1, 'https://files.example/a')).toBeUndefined()
    names.expect(1, 'https://files.example/a', 'a.csv')
    names.clear()
    expect(names.take(1, 'https://files.example/a')).toBeUndefined()
  })
})

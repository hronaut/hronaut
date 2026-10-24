import { describe, expect, it } from 'vitest'
import { MAX_IMPORTED_LINKS, bookmarksHtml, decodeBookmarksFile, parseBookmarksHtml } from '../src/main/bookmarks-html.js'
import type { BrowserBookmark } from '../src/shared/types.js'

function bookmark(id: string, url: string, title: string): BrowserBookmark {
  return { id, url, title, createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-02T10:00:00.000Z' }
}

// As Chrome 141 exports them: the bookmarks bar is a folder of its own, other bookmarks follow it.
const chromeExport = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file.
     It will be read and overwritten.
     DO NOT EDIT! -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1700000000" LAST_MODIFIED="1700000100" PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>
    <DL><p>
        <DT><A HREF="https://bar.example/" ADD_DATE="1700000001" ICON="data:image/png;base64,iVBORw0KGgo=">On the bar</A>
        <DT><H3 ADD_DATE="1700000002" LAST_MODIFIED="1700000003">Work</H3>
        <DL><p>
            <DT><A HREF="https://work.example/tickets?q=a&amp;b=c" ADD_DATE="1700000004">Tickets &amp; bugs</A>
            <DT><H3 ADD_DATE="1700000005">Staging</H3>
            <DL><p>
                <DT><A HREF="https://staging.example/" ADD_DATE="1700000006">Staging</A>
            </DL><p>
            <DT><A HREF="https://work.example/wiki" ADD_DATE="1700000007">Wiki</A>
        </DL><p>
    </DL><p>
    <DT><A HREF="https://other.example/" ADD_DATE="1700000008">Other bookmark</A>
</DL><p>
`

// As Firefox exports them: the menu's bookmarks are at the top, with descriptions, separators and the toolbar.
const firefoxExport = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'none'; img-src data: *; object-src 'none'"></meta>
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks Menu</H1>
<DL><p>
    <DT><A HREF="https://menu.example/" ADD_DATE="1600000000" LAST_MODIFIED="1600000001">Menu bookmark</A>
    <DD>A description that is not part of the title
    <HR>
    <DT><H3 ADD_DATE="1600000002" LAST_MODIFIED="1600000003" PERSONAL_TOOLBAR_FOLDER="true">Bookmarks Toolbar</H3>
    <DL><p>
        <DT><A HREF="https://toolbar.example/" ADD_DATE="1600000004" TAGS="dev,docs">Toolbar bookmark</A>
    </DL><p>
    <DT><H3 ADD_DATE="1600000005" UNFILED_BOOKMARKS_FOLDER="true">Other Bookmarks</H3>
    <DL><p>
        <DT><H3>Recipes</H3>
        <DL><p>
            <DT><A HREF="https://food.example/">Soup</A>
        </DL><p>
        <DT><A HREF="place:sort=8&amp;maxResults=10">Most Visited</A>
    </DL><p>
</DL>
`

// In Safari's shape: no list around its top folders, and only its Reading List marked as its own.
const safariExport = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
\t<HTML>
\t<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
\t<Title>Bookmarks</Title>
\t<H1>Bookmarks</H1>
\t<DT><H3 FOLDED>Favorites</H3>
\t<DL><p>
\t\t<DT><A HREF="https://favorite.example/">Favorite</A>
\t</DL><p>
\t<DT><H3 FOLDED>Bookmarks Menu</H3>
\t<DL><p>
\t\t<DT><A HREF="https://menu.example/">In the menu</A>
\t</DL><p>
\t<DT><H3 FOLDED>Trips</H3>
\t<DL><p>
\t\t<DT><A HREF="https://trip.example/">Trip</A>
\t</DL><p>
\t<DT><H3 id="com.apple.ReadingList" FOLDED>Reading List</H3>
\t<DL><p>
\t\t<DT><A HREF="https://read.example/later">Read later</A>
\t</DL><p>
</HTML>
`

describe('bookmarksHtml', () => {
  it('writes each collection as a folder and the other bookmarks after them, as Chrome exports', () => {
    const html = bookmarksHtml(
      [bookmark('a', 'https://a.example/?x=1&y="2"', 'A <b> & "quotes"'), bookmark('b', 'https://b.example/', 'B'), bookmark('c', 'https://c.example/', 'C')],
      [{ id: 'work', name: 'Work & play', bookmarkIds: ['b', 'missing'] }, { id: 'empty', name: 'Empty', bookmarkIds: [] }]
    )
    expect(html).toBe(`<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file.
     It will be read and overwritten.
     DO NOT EDIT! -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3>Work &amp; play</H3>
    <DL><p>
        <DT><A HREF="https://b.example/" ADD_DATE="1790848800" LAST_MODIFIED="1790935200">B</A>
    </DL><p>
    <DT><H3>Empty</H3>
    <DL><p>
    </DL><p>
    <DT><A HREF="https://a.example/?x=1&amp;y=&quot;2&quot;" ADD_DATE="1790848800" LAST_MODIFIED="1790935200">A &lt;b&gt; &amp; &quot;quotes&quot;</A>
    <DT><A HREF="https://c.example/" ADD_DATE="1790848800" LAST_MODIFIED="1790935200">C</A>
</DL><p>
`)
  })

  it('reads back what it writes', () => {
    const bookmarks = [bookmark('a', 'https://a.example/?q=<x>&r="y"', 'Tom & Jerry\'s <page>'), bookmark('b', 'https://b.example/', 'B')]
    expect(parseBookmarksHtml(bookmarksHtml(bookmarks, [{ id: 'f', name: 'Folder <1>', bookmarkIds: ['a'] }])).bookmarks).toEqual([
      { url: 'https://a.example/?q=<x>&r="y"', title: 'Tom & Jerry\'s <page>', folder: 'Folder <1>', addedAt: '2026-10-01T10:00:00.000Z' },
      { url: 'https://b.example/', title: 'B', addedAt: '2026-10-01T10:00:00.000Z' }
    ])
  })
})

describe('parseBookmarksHtml', () => {
  it('reads Chrome\'s export, each bookmark in its innermost folder and none in the bookmarks bar itself', () => {
    expect(parseBookmarksHtml(chromeExport)).toEqual({ notRead: 0, bookmarks: [
      { url: 'https://bar.example/', title: 'On the bar', addedAt: '2023-11-14T22:13:21.000Z' },
      { url: 'https://work.example/tickets?q=a&b=c', title: 'Tickets & bugs', folder: 'Work', addedAt: '2023-11-14T22:13:24.000Z' },
      { url: 'https://staging.example/', title: 'Staging', folder: 'Staging', addedAt: '2023-11-14T22:13:26.000Z' },
      { url: 'https://work.example/wiki', title: 'Wiki', folder: 'Work', addedAt: '2023-11-14T22:13:27.000Z' },
      { url: 'https://other.example/', title: 'Other bookmark', addedAt: '2023-11-14T22:13:28.000Z' }
    ] })
  })

  it('reads Firefox\'s export, leaving out descriptions and its toolbar and other bookmarks folders', () => {
    expect(parseBookmarksHtml(firefoxExport).bookmarks).toEqual([
      { url: 'https://menu.example/', title: 'Menu bookmark', addedAt: '2020-09-13T12:26:40.000Z' },
      { url: 'https://toolbar.example/', title: 'Toolbar bookmark', addedAt: '2020-09-13T12:26:44.000Z' },
      { url: 'https://food.example/', title: 'Soup', folder: 'Recipes' },
      // The store leaves out what is not a web page.
      { url: 'place:sort=8&maxResults=10', title: 'Most Visited' }
    ])
  })

  it('reads hand-written and damaged files as a browser would, without running or loading anything', () => {
    const html = `<dl><dt><h3>Caf\u00E9 &#38; &#x1F600; <i>folder</i></h3><dl>
      <dt><a href='https://single.example/' add_date="soon">Single &lt;quoted&gt;</a>
      <dt><a HREF=https://unquoted.example/path>Unquoted
      <dt><abbr title="not a link">abbr</abbr><a href="https://after-abbr.example/">After &#0; &#xD800; &#1114112;</a>
      <dt><a name="no-href">No address</a>
      <dt><a href="https://untitled.example/"></a>
      <dt><a href="javascript:alert(1)" onclick="alert(2)">Script</a><script>alert(3)</script>
    </dl></dl><dt><a href="https://outside.example/">Outside</a>`
    expect(parseBookmarksHtml(html).bookmarks).toEqual([
      { url: 'https://single.example/', title: 'Single <quoted>', folder: 'Caf\u00E9 & \u{1F600} folder' },
      { url: 'https://unquoted.example/path', title: 'Unquoted', folder: 'Caf\u00E9 & \u{1F600} folder' },
      { url: 'https://after-abbr.example/', title: 'After � � �', folder: 'Caf\u00E9 & \u{1F600} folder' },
      { url: 'https://untitled.example/', title: '', folder: 'Caf\u00E9 & \u{1F600} folder' },
      { url: 'javascript:alert(1)', title: 'Script', folder: 'Caf\u00E9 & \u{1F600} folder' },
      { url: 'https://outside.example/', title: 'Outside' }
    ])
    expect(parseBookmarksHtml('Not a bookmarks file')).toEqual({ bookmarks: [], notRead: 0 })
  })

  it('reads Safari\'s export, keeping its top folders as folders, as Chrome\'s importer does, but not its Reading List', () => {
    expect(parseBookmarksHtml(safariExport).bookmarks).toEqual([
      { url: 'https://favorite.example/', title: 'Favorite', folder: 'Favorites' },
      { url: 'https://menu.example/', title: 'In the menu', folder: 'Bookmarks Menu' },
      { url: 'https://trip.example/', title: 'Trip', folder: 'Trips' },
      { url: 'https://read.example/later', title: 'Read later' }
    ])
  })

  it('reads no more than a bookmarks file holds and counts the links it leaves unread', () => {
    const links = Array.from({ length: MAX_IMPORTED_LINKS + 5 }, (_, index) => `<DT><A HREF="https://e.example/${index}">${index}</A>`)
    const { bookmarks, notRead } = parseBookmarksHtml(`<DL><p>${links.join('\n')}<DT><A NAME="no-address">None</A></DL><p>`)
    expect(bookmarks).toHaveLength(MAX_IMPORTED_LINKS)
    expect(bookmarks.at(-1)).toEqual({ url: `https://e.example/${MAX_IMPORTED_LINKS - 1}`, title: String(MAX_IMPORTED_LINKS - 1) })
    // A link with no address would not have been a bookmark either.
    expect(notRead).toBe(5)
  })

  it('reads a hostile file as quickly as any other of its size', () => {
    // Tags that never close, each of which once made the reader look to the end of the file.
    const hostile = ['<a '.repeat(70_000), `<dl><dt><a href="https://e.example/">${'<'.repeat(200_000)}`, `<dl><dt><h3>${'<x'.repeat(100_000)}`]
    const started = performance.now()
    const read = hostile.map(html => parseBookmarksHtml(html).bookmarks.length)
    expect(read).toEqual([0, 1, 0])
    expect(performance.now() - started).toBeLessThan(2_000)
  })
})

describe('decodeBookmarksFile', () => {
  const page = '<DL><p><DT><A HREF="https://e.example/">Caf\u00E9 \u{1F600}</A></DL><p>'

  it('reads the encoding a byte order mark gives', () => {
    const utf16 = Buffer.from(`\uFEFF${page}`, 'utf16le')
    expect(decodeBookmarksFile(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(page)]))).toBe(page)
    expect(decodeBookmarksFile(utf16)).toBe(page)
    expect(decodeBookmarksFile(Buffer.from(utf16).swap16())).toBe(page)
  })

  it('reads the encoding the file\'s META names, and UTF-8 for one it cannot be', () => {
    const declared = (charset: string, text: string) => `<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=${charset}">\n<DL><p><DT><A HREF="https://e.example/">${text}</A></DL><p>`
    expect(decodeBookmarksFile(Buffer.from(declared('windows-1252', 'Caf\u00E9'), 'latin1'))).toBe(declared('windows-1252', 'Caf\u00E9'))
    expect(decodeBookmarksFile(Buffer.from(`<meta charset='koi8-r'>\u00F0\u00D2\u00C9\u00D7\u00C5\u00D4`, 'latin1'))).toBe('<meta charset=\'koi8-r\'>\u041F\u0440\u0438\u0432\u0435\u0442')
    // A file read without a byte order mark cannot be UTF-16, and a name no decoder knows tells nothing.
    expect(decodeBookmarksFile(Buffer.from(declared('utf-16', 'Caf\u00E9')))).toBe(declared('utf-16', 'Caf\u00E9'))
    expect(decodeBookmarksFile(Buffer.from(declared('x-unknown', 'Caf\u00E9')))).toBe(declared('x-unknown', 'Caf\u00E9'))
    expect(decodeBookmarksFile(Buffer.from(page))).toBe(page)
    expect(decodeBookmarksFile(Buffer.from([0x3c, 0x61, 0x3e, 0xff, 0x3c, 0x2f, 0x61, 0x3e]))).toBe('<a>\uFFFD</a>')
  })
})

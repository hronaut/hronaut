import type { BrowserBookmark, BrowserBookmarkCollection } from '../shared/types.js'

/** A bookmark read from a bookmarks file, as the person's other browser wrote it; the store checks every field. */
export interface ImportedBookmark {
  url: string
  title: string
  /** The folder it was in, the innermost one other than a browser's own bookmarks bar or other bookmarks. */
  folder?: string
  addedAt?: string
}

/** More links than any bookmarks file a person keeps; the links of a larger file past these are counted, not read. */
export const MAX_IMPORTED_LINKS = 20_000

/** The bookmarks read from a file, and how many links past {@link MAX_IMPORTED_LINKS} were left unread. */
export interface ParsedBookmarksFile {
  bookmarks: ImportedBookmark[]
  notRead: number
}

/** Chrome's, Edge's and Firefox's bookmarks bar and other bookmarks, and Safari's Reading List. */
const ROOT_FOLDER = /\b(?:personal_toolbar_folder|unfiled_bookmarks_folder)\s*=|(?:^|\s)id\s*=\s*["']?com\.apple\.readinglist\b/iu
const NAMED_ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ' }

function escapeHtml(value: string): string {
  return value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;')
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{1,32});/giu, (entity, name: string) => {
    if (name[0] !== '#') return NAMED_ENTITIES[name.toLowerCase()] ?? entity
    const codePoint = name[1] === 'x' || name[1] === 'X' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10)
    return codePoint > 0 && codePoint <= 0x10ffff && (codePoint < 0xd800 || codePoint > 0xdfff) ? String.fromCodePoint(codePoint) : '\uFFFD'
  })
}

/**
 * An element's text, as plain text: each tag read as a space, so no two pieces of the file join into one, its entities
 * decoded and its spaces collapsed. A tag ends at the next < as well as at >, so a file full of unclosed tags takes as
 * long to read as any other of its size. The text is never markup: it is escaped wherever it is written as HTML.
 */
function elementText(html: string): string {
  return decodeEntities(html.replace(/<[^<>]*>/gu, ' ')).replace(/\s+/gu, ' ').trim()
}

function attribute(attributes: string, name: string): string | undefined {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+))`, 'iu').exec(attributes)
  const value = match?.[1] ?? match?.[2] ?? match?.[3]
  return value === undefined ? undefined : decodeEntities(value).trim()
}

/** Seconds since 1970, as browsers write ADD_DATE, as a time; none for anything else. */
function addedAt(value: string | undefined): string | undefined {
  if (!value || !/^\d{1,12}$/u.test(value)) return undefined
  const time = Number(value) * 1000
  return time > 0 && time <= 8.64e15 ? new Date(time).toISOString() : undefined
}

/** Where an element's text ends: at its closing tag, or where the next element starts when a file leaves it open. */
function textEnd(html: string, from: number, tag: 'h3' | 'a'): { end: number; next: number } {
  const close = new RegExp(`</${tag}\\s*>|<(?:dt|dl|/dl|h3|a)[\\s>]`, 'giu')
  close.lastIndex = from
  const match = close.exec(html)
  if (!match) return { end: html.length, next: html.length }
  const closed = match[0].toLowerCase().startsWith(`</${tag}`)
  return { end: match.index, next: closed ? close.lastIndex : match.index }
}

/**
 * The bookmarks in an HTML bookmarks file, in the format Chrome, Firefox, Safari and Edge export, each with the folder
 * it was in. Only the file's structure is read: nothing in it runs or loads. A browser's own top folders that the file
 * marks as such are not folders here; Safari marks none but its Reading List, so its Favorites and Bookmarks Menu stay
 * folders, as Chrome's and Firefox's importers keep them.
 */
export function parseBookmarksHtml(html: string): ParsedBookmarksFile {
  const bookmarks: ImportedBookmark[] = []
  let notRead = 0
  const folders: (string | undefined)[] = []
  const tokens = /<(\/?)(dl|h3|a)(?=[\s>/])([^<>]*)>/giu
  let heading: string | undefined
  for (let token = tokens.exec(html); token; token = tokens.exec(html)) {
    const [, closing, name, attributes] = token
    const tag = name!.toLowerCase()
    if (tag === 'dl') {
      if (closing) folders.pop()
      else folders.push(heading)
      heading = undefined
    } else if (!closing && (tag === 'h3' || tag === 'a')) {
      if (tag === 'a' && bookmarks.length >= MAX_IMPORTED_LINKS) {
        if (attribute(attributes!, 'href')) notRead += 1
        continue
      }
      const { end, next } = textEnd(html, tokens.lastIndex, tag)
      const text = elementText(html.slice(tokens.lastIndex, end))
      tokens.lastIndex = next
      if (tag === 'h3') {
        // A browser's own bookmarks bar and other bookmarks are where bookmarks are, not folders the person made.
        heading = ROOT_FOLDER.test(attributes!) ? undefined : text || undefined
        continue
      }
      const url = attribute(attributes!, 'href')
      if (!url) continue
      const folder = folders.findLast(candidate => candidate !== undefined)
      const added = addedAt(attribute(attributes!, 'add_date'))
      bookmarks.push({ url, title: text, ...(folder ? { folder } : {}), ...(added ? { addedAt: added } : {}) })
    }
  }
  return { bookmarks, notRead }
}

/** The decoder for the encoding a file's META names; UTF-8 for one no decoder has, or for UTF-16, as browsers read it. */
function declaredDecoder(label: string | undefined): TextDecoder {
  try {
    const decoder = new TextDecoder(label ?? 'utf-8')
    if (!decoder.encoding.startsWith('utf-16')) return decoder
  } catch {
    // An encoding no decoder knows.
  }
  return new TextDecoder('utf-8')
}

/**
 * A bookmarks file's text, read as a browser reads an HTML file: in the encoding its byte order mark gives, else in the
 * one its META names, else as UTF-8. Bytes that are not text in that encoding read as replacement characters.
 */
export function decodeBookmarksFile(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes)
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes)
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes)
  const head = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.length, 1024)).toString('latin1')
  const declared = /<meta\b[^<>]*?\bcharset\s*=\s*["']?\s*([\w.:-]{1,40})/iu.exec(head)?.[1]
  return declaredDecoder(declared).decode(bytes)
}

function bookmarkLine(bookmark: BrowserBookmark, indent: string): string {
  const added = Math.floor(Date.parse(bookmark.createdAt) / 1000)
  const modified = Math.floor(Date.parse(bookmark.updatedAt) / 1000)
  return `${indent}<DT><A HREF="${escapeHtml(bookmark.url)}" ADD_DATE="${added}" LAST_MODIFIED="${modified}">${escapeHtml(bookmark.title)}</A>`
}

/**
 * Bookmarks as an HTML bookmarks file, as Chrome's bookmark manager exports them, which Chrome, Firefox, Safari and
 * Edge import: each collection is a folder, and bookmarks in none follow them.
 */
export function bookmarksHtml(bookmarks: readonly BrowserBookmark[], collections: readonly BrowserBookmarkCollection[]): string {
  const byId = new Map(bookmarks.map(bookmark => [bookmark.id, bookmark]))
  const filed = new Set<string>()
  const lines = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<!-- This is an automatically generated file.',
    '     It will be read and overwritten.',
    '     DO NOT EDIT! -->',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>'
  ]
  for (const collection of collections) {
    lines.push(`    <DT><H3>${escapeHtml(collection.name)}</H3>`, '    <DL><p>')
    for (const id of collection.bookmarkIds) {
      const bookmark = byId.get(id)
      if (!bookmark) continue
      filed.add(id)
      lines.push(bookmarkLine(bookmark, '        '))
    }
    lines.push('    </DL><p>')
  }
  for (const bookmark of bookmarks) if (!filed.has(bookmark.id)) lines.push(bookmarkLine(bookmark, '    '))
  lines.push('</DL><p>', '')
  return lines.join('\n')
}

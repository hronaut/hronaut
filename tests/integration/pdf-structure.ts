import { expect } from '@playwright/test'

export interface Bookmark { title: string; page: number; children: Bookmark[] }

// Chromium writes the outline, page tree and catalog as plain objects, so the test reads them without a PDF library.
function pdfObjects(pdf: Buffer): Map<number, string> {
  const objects = new Map<number, string>()
  for (const match of pdf.toString('latin1').matchAll(/(\d+) 0 obj\s*(<<[\s\S]*?>>)\s*(?:stream|endobj)/g)) {
    objects.set(Number(match[1]), match[2]!)
  }
  return objects
}

function reference(body: string, key: string): number | undefined {
  const match = new RegExp(`/${key}\\s+(\\d+) 0 R`).exec(body)
  return match ? Number(match[1]) : undefined
}

function pdfString(body: string, key: string): string {
  const start = body.indexOf(`/${key}`)
  if (start < 0) throw new Error(`Missing /${key}`)
  let index = start + key.length + 1
  while (/\s/.test(body[index]!)) index += 1
  if (body[index] === '<') {
    const hex = body.slice(index + 1, body.indexOf('>', index)).replace(/\s/g, '')
    const bytes = Buffer.from(hex, 'hex')
    if (bytes[0] !== 0xfe || bytes[1] !== 0xff) return bytes.toString('latin1')
    return Buffer.from(bytes.subarray(2)).swap16().toString('utf16le')
  }
  if (body[index] !== '(') throw new Error(`/${key} is not a string`)
  const bytes: number[] = []
  let depth = 0
  for (index += 1; index < body.length; index += 1) {
    const char = body[index]!
    if (char === '\\') {
      const next = body[++index]!
      const octal = /^[0-7]{1,3}/.exec(body.slice(index, index + 3))?.[0]
      if (octal) {
        bytes.push(parseInt(octal, 8))
        index += octal.length - 1
      } else if (next === '\r') {
        if (body[index + 1] === '\n') index += 1
      } else if (next !== '\n') {
        bytes.push(({ n: 10, r: 13, t: 9, b: 8, f: 12 } as Record<string, number>)[next] ?? next.charCodeAt(0))
      }
      continue
    }
    if (char === ')' && depth === 0) return Buffer.from(bytes).toString('latin1')
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    bytes.push(char.charCodeAt(0))
  }
  throw new Error(`Unterminated /${key}`)
}

function catalog(objects: Map<number, string>): string {
  const found = [...objects.values()].find(body => /\/Type\s*\/Catalog\b/.test(body))
  if (!found) throw new Error('PDF catalog not found')
  return found
}

function pageOrder(objects: Map<number, string>): number[] {
  const pages: number[] = []
  const visit = (id: number): void => {
    const body = objects.get(id)
    if (!body) throw new Error(`Missing page tree object ${id}`)
    if (/\/Type\s*\/Pages\b/.test(body)) {
      for (const kid of /\/Kids\s*\[([^\]]*)\]/.exec(body)![1]!.matchAll(/(\d+) 0 R/g)) visit(Number(kid[1]))
    } else {
      pages.push(id)
    }
  }
  visit(reference(catalog(objects), 'Pages')!)
  return pages
}

export function pageSizes(pdf: Buffer): Array<{ width: number; height: number }> {
  const objects = pdfObjects(pdf)
  return pageOrder(objects).map(id => {
    const [left, bottom, right, top] = /\/MediaBox\s*\[([^\]]*)\]/.exec(objects.get(id)!)![1]!.trim().split(/\s+/).map(Number)
    return { width: right! - left!, height: top! - bottom! }
  })
}

/** Reads the bookmark tree with 1-based destination pages, checking each entry's links, or null without an outline. */
export function readOutline(pdf: Buffer): Bookmark[] | null {
  const objects = pdfObjects(pdf)
  const pages = pageOrder(objects)
  const root = reference(catalog(objects), 'Outlines')
  if (root === undefined) return null
  const seen = new Set<number>()
  const children = (parentId: number): Bookmark[] => {
    const parent = objects.get(parentId)
    if (!parent) throw new Error(`Missing bookmark parent ${parentId}`)
    const items: Bookmark[] = []
    let previous: number | undefined
    for (let id = reference(parent, 'First'); id !== undefined; id = reference(objects.get(id)!, 'Next')) {
      if (seen.has(id)) throw new Error(`Bookmark ${id} appears twice`)
      seen.add(id)
      const body = objects.get(id)
      if (!body) throw new Error(`Missing bookmark ${id}`)
      expect(reference(body, 'Parent')).toBe(parentId)
      expect(reference(body, 'Prev')).toBe(previous)
      const destination = /\/Dest\s*\[\s*(\d+) 0 R\s*\/XYZ/.exec(body)
      if (!destination) throw new Error(`Bookmark ${id} has no page destination`)
      const page = pages.indexOf(Number(destination[1])) + 1
      expect(page).toBeGreaterThan(0)
      items.push({ title: pdfString(body, 'Title'), page, children: children(id) })
      previous = id
    }
    expect(reference(parent, 'Last')).toBe(previous)
    return items
  }
  return children(root)
}

export function countBookmarks(bookmarks: Bookmark[]): number {
  return bookmarks.reduce((total, bookmark) => total + 1 + countBookmarks(bookmark.children), 0)
}

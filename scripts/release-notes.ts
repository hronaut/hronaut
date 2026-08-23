import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function changelogReleaseNotes(changelog: string, version: string): string {
  if (!/^\d+\.\d+\.\d+(?:[+-][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid release version: ${version}`)
  }
  const lines = changelog.split(/\r?\n/)
  const heading = `## [${version}]`
  const start = lines.findIndex((line) => line === heading || line.startsWith(`${heading} `))
  if (start < 0) throw new Error(`CHANGELOG.md has no section for ${version}`)
  const endOffset = lines.slice(start + 1).findIndex((line) => /^## \[/.test(line))
  const end = endOffset < 0 ? lines.length : start + 1 + endOffset
  const notes = lines.slice(start + 1, end).join('\n').trim()
  if (!notes || !/^### /m.test(notes) || !/^- /m.test(notes)) {
    throw new Error(`CHANGELOG.md section ${version} must contain a heading and bullet items`)
  }
  return notes
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  const version = process.argv[2]
  if (!version) throw new Error('Usage: node scripts/release-notes.ts <version> [changelog-path]')
  const changelog = await readFile(resolve(process.argv[3] ?? 'CHANGELOG.md'), 'utf8')
  process.stdout.write(`${changelogReleaseNotes(changelog, version)}\n`)
}

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

const RELEASE_NOTES_MARKER = '<!-- hronaut-release-notes -->'
const GENERATED_NOTES_MARKER = '<!-- hronaut-generated-notes -->'
const UNSIGNED_WARNING_MARKER = '<!-- unsigned-release-warning -->'
const UNSIGNED_WARNING = '> [!WARNING]\n> These desktop artifacts are not platform code-signed or Apple-notarized. macOS Gatekeeper and Windows SmartScreen may warn before first launch. [Verify the download with SHA-256 and GitHub artifact attestations](https://hronaut.dev/security#verify-release) before overriding either warning.'

function comparisonNotes(currentNotes: string): string {
  const marker = currentNotes.indexOf(GENERATED_NOTES_MARKER)
  if (marker < 0 && currentNotes.includes(RELEASE_NOTES_MARKER)) return ''
  const notes = marker >= 0
    ? currentNotes.slice(marker + GENERATED_NOTES_MARKER.length)
    : currentNotes
  return notes
    .trim()
    .replace(/^(?:---[ \t]*(?:\r?\n|$)[\r\n]*)+/u, '')
    .trim()
}

export function completeReleaseNotes(changelog: string, version: string, currentNotes: string): string {
  const sections = [
    `${RELEASE_NOTES_MARKER}\n${UNSIGNED_WARNING_MARKER}\n${UNSIGNED_WARNING}`,
    "## What's changed",
    changelogReleaseNotes(changelog, version)
  ]
  const comparison = comparisonNotes(currentNotes)
  if (comparison) sections.push(`${GENERATED_NOTES_MARKER}\n---\n${comparison}`)
  return sections.join('\n\n')
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  const version = process.argv[2]
  if (!version) throw new Error('Usage: node scripts/release-notes.ts <version> [changelog-path] [current-notes-path]')
  const changelog = await readFile(resolve(process.argv[3] ?? 'CHANGELOG.md'), 'utf8')
  const currentNotesPath = process.argv[4]
  const notes = currentNotesPath
    ? completeReleaseNotes(changelog, version, await readFile(resolve(currentNotesPath), 'utf8'))
    : changelogReleaseNotes(changelog, version)
  process.stdout.write(`${notes}\n`)
}

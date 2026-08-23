import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { changelogReleaseNotes } from '../scripts/release-notes.js'

describe('GitHub release notes', () => {
  it('keeps categorized release notes for the current package version', () => {
    const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
    const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
    expect(changelogReleaseNotes(changelog, packageJson.version)).toMatch(/^### /)
  })

  it('extracts only the requested changelog section with its bullet items', () => {
    expect(changelogReleaseNotes(`# Changelog

## [Unreleased]

## [2.0.0] - 2026-08-14

### Added

- New workflow.

### Fixed

- Clear explanation.

## [1.0.0] - 2026-08-13

### Added

- Older work.
`, '2.0.0')).toBe(`### Added

- New workflow.

### Fixed

- Clear explanation.`)
  })

  it('fails closed when release notes have no explanatory bullets', () => {
    expect(() => changelogReleaseNotes('## [1.2.3]\n\nNo details.', '1.2.3')).toThrow('heading and bullet items')
    expect(() => changelogReleaseNotes('## [1.2.2]\n\n### Added\n\n- Existing.', '1.2.3')).toThrow('no section')
    expect(() => changelogReleaseNotes('## [1.2.3]\n\n### Added\n\n- Existing.', '../bad')).toThrow('Invalid release version')
  })
})

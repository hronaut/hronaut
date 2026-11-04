import { describe, expect, it } from 'vitest'
import { discordReleaseAnnouncement } from '../scripts/discord-release-announcement.js'

interface Announcement {
  allowed_mentions: { parse: string[] }
  embeds: Array<{ title: string; url: string; description: string }>
}

function announcement(notes: string): Announcement {
  return discordReleaseAnnouncement(`# Changelog\n\n## [2.0.0] - 2026-08-14\n\n${notes}\n\n## [1.0.0] - 2026-08-13\n\n### Added\n\n- Old.\n`, '2.0.0') as Announcement
}

describe('Discord release announcement', () => {
  it('posts the changelog section of the requested version with a link to its release', () => {
    expect(announcement('### Fixed\n\n- Clear explanation.').embeds).toEqual([{
      title: 'Hronaut 2.0.0',
      url: 'https://github.com/hronaut/hronaut/releases/tag/v2.0.0',
      description: '### Fixed\n\n- Clear explanation.'
    }])
  })

  it('never lets changelog text ping anyone', () => {
    expect(announcement('### Fixed\n\n- A fix for @everyone.').allowed_mentions).toEqual({ parse: [] })
  })

  it('cuts a long changelog between bullets and counts what it left out', () => {
    const bullets = Array.from({ length: 100 }, (_, index) => `- Change ${index} ${'x'.repeat(100)}`)
    const { description } = announcement(`### Fixed\n\n${bullets.join('\n')}`).embeds[0]!
    const kept = description.split('\n').filter((line) => line.startsWith('- '))

    expect(description.length).toBeLessThanOrEqual(4096)
    expect(kept.length).toBeGreaterThan(0)
    expect(kept).toEqual(bullets.slice(0, kept.length))
    expect(description.endsWith(`[…and ${100 - kept.length} more in the full release notes](https://github.com/hronaut/hronaut/releases/tag/v2.0.0)`)).toBe(true)
  })

  it('does not end a cut changelog on a heading without its bullets', () => {
    const fixed = Array.from({ length: 37 }, (_, index) => `- Change ${index} ${'x'.repeat(90)}`)
    const { description } = announcement(`### Fixed\n\n${fixed.join('\n')}\n\n### Added\n\n- ${'y'.repeat(600)}`).embeds[0]!

    expect(description.length).toBeLessThanOrEqual(4096)
    expect(description).not.toContain('### Added')
    expect(description).toContain('[…and 1 more in the full release notes]')
  })

  it('falls back to the link when the first bullet alone exceeds the limit', () => {
    const { description } = announcement(`### Fixed\n\n- ${'x'.repeat(5000)}`).embeds[0]!
    expect(description).toBe('[…and 1 more in the full release notes](https://github.com/hronaut/hronaut/releases/tag/v2.0.0)')
  })

  it('rejects a version the changelog does not have', () => {
    expect(() => discordReleaseAnnouncement('# Changelog\n', '9.9.9')).toThrow('no section for 9.9.9')
  })
})

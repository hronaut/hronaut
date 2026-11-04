import { describe, expect, it, vi } from 'vitest'
import { announceOnDiscord, discordReleaseAnnouncement } from '../scripts/discord-release-announcement.js'

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

describe('Discord release delivery', () => {
  const changelog = '# Changelog\n\n## [2.0.0] - 2026-08-14\n\n### Fixed\n\n- A fix.\n'
  const webhookUrl = 'https://discord.com/api/webhooks/1/webhook-secret'
  const botToken = 'bot-secret'

  function discord(...responses: Response[]) {
    const send = vi.fn<typeof fetch>()
    for (const response of responses) send.mockResolvedValueOnce(response)
    return send
  }

  function posted(): Response {
    return Response.json({ id: '22', channel_id: '33' })
  }

  it('asks the webhook for the created message and publishes that message as the bot', async () => {
    const send = discord(posted(), new Response('{}'))

    await expect(announceOnDiscord(changelog, '2.0.0', { webhookUrl, botToken }, send)).resolves.toEqual({ published: true })

    expect(send).toHaveBeenCalledTimes(2)
    expect(String(send.mock.calls[0]![0])).toBe(`${webhookUrl}?wait=true`)
    expect(send.mock.calls[0]![1]).not.toHaveProperty('headers.authorization')
    expect(send.mock.calls[1]![0]).toBe('https://discord.com/api/v10/channels/33/messages/22/crosspost')
    expect(send.mock.calls[1]![1]).toEqual({ method: 'POST', headers: { authorization: 'Bot bot-secret' } })
  })

  it('still posts without the bot token and leaves publishing to a person', async () => {
    const send = discord(posted())

    await expect(announceOnDiscord(changelog, '2.0.0', { webhookUrl }, send)).resolves.toEqual({ published: false })

    expect(send).toHaveBeenCalledTimes(1)
  })

  it('does not try to publish a post Discord rejected, and names only the status', async () => {
    const send = discord(new Response('{}', { status: 404 }))

    const failure = announceOnDiscord(changelog, '2.0.0', { webhookUrl, botToken }, send)

    await expect(failure).rejects.toThrow('Discord rejected the announcement with status 404')
    await expect(failure).rejects.not.toThrow('webhook-secret')
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('reports a refused publish separately, without the bot token', async () => {
    const send = discord(posted(), new Response('{}', { status: 403 }))

    const failure = announceOnDiscord(changelog, '2.0.0', { webhookUrl, botToken }, send)

    await expect(failure).rejects.toThrow('Discord posted the announcement but refused to publish it with status 403')
    await expect(failure).rejects.not.toThrow('bot-secret')
  })
})

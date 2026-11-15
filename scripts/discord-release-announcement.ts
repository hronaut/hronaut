import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { isMainModule } from './is-main-module.ts'
import { changelogReleaseNotes } from './release-notes.ts'

const EMBED_DESCRIPTION_LIMIT = 4096

function fitDescription(notes: string, releaseUrl: string): string {
  if (notes.length <= EMBED_DESCRIPTION_LIMIT) return notes

  const lines = notes.split('\n')
  const bulletCount = lines.filter((line) => line.startsWith('- ')).length
  // The longest possible remainder link, so that the kept lines can never push the text over the limit.
  const budget = EMBED_DESCRIPTION_LIMIT - moreLink(bulletCount, releaseUrl).length - 2
  const kept: string[] = []
  let length = 0
  for (const line of lines) {
    if (length + line.length + 1 > budget) break
    kept.push(line)
    length += line.length + 1
  }
  while (kept.length > 0 && !kept[kept.length - 1]!.startsWith('- ')) kept.pop()

  const keptBullets = kept.filter((line) => line.startsWith('- ')).length
  const link = moreLink(bulletCount - keptBullets, releaseUrl)
  return kept.length > 0 ? `${kept.join('\n')}\n\n${link}` : link
}

function moreLink(count: number, releaseUrl: string): string {
  return `[…and ${count} more in the full release notes](${releaseUrl})`
}

export function discordReleaseAnnouncement(changelog: string, version: string): unknown {
  const releaseUrl = `https://github.com/hronaut/hronaut/releases/tag/v${version}`
  return {
    // Changelog text is data: it must never ping @everyone, a role, or a member.
    allowed_mentions: { parse: [] },
    embeds: [{
      title: `Hronaut ${version}`,
      url: releaseUrl,
      description: fitDescription(changelogReleaseNotes(changelog, version), releaseUrl)
    }]
  }
}

interface DiscordCredentials {
  webhookUrl: string
  botToken?: string | undefined
}

/**
 * Posts through the webhook, then publishes the post to the servers that follow the channel. A webhook can post to an
 * Announcement channel but cannot publish there, so publishing takes a bot. Both credentials stay out of every error.
 */
export async function announceOnDiscord(
  changelog: string,
  version: string,
  { webhookUrl, botToken }: DiscordCredentials,
  send: typeof fetch = fetch
): Promise<{ published: boolean }> {
  const postUrl = new URL(webhookUrl)
  // Without wait, Discord answers 204 and never says which message it created.
  postUrl.searchParams.set('wait', 'true')
  const posted = await send(postUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(discordReleaseAnnouncement(changelog, version))
  })
  if (!posted.ok) throw new Error(`Discord rejected the announcement with status ${posted.status}`)
  if (!botToken) return { published: false }

  const { id, channel_id: channelId } = await posted.json() as { id: string; channel_id: string }
  const published = await send(`https://discord.com/api/v10/channels/${channelId}/messages/${id}/crosspost`, {
    method: 'POST',
    headers: { authorization: `Bot ${botToken}` }
  })
  if (!published.ok) throw new Error(`Discord posted the announcement but refused to publish it with status ${published.status}`)
  return { published: true }
}

if (isMainModule(import.meta.url)) {
  const version = process.argv[2]
  if (!version) throw new Error('Usage: node scripts/discord-release-announcement.ts <version> [changelog-path]')
  const webhookUrl = process.env.DISCORD_RELEASE_WEBHOOK_URL
  if (!webhookUrl) {
    console.log('DISCORD_RELEASE_WEBHOOK_URL is not set; skipping the Discord announcement.')
  } else {
    const changelog = await readFile(resolve(process.argv[3] ?? 'CHANGELOG.md'), 'utf8')
    const { published } = await announceOnDiscord(changelog, version, {
      webhookUrl,
      botToken: process.env.DISCORD_RELEASE_BOT_TOKEN || undefined
    })
    console.log(`Announced Hronaut ${version} on Discord${published ? ' and published it to followers' : ''}.`)
  }
}

import { join } from 'node:path'
import { expect, it } from 'vitest'
import { agentVideoState } from '../src/main/mcp/tools/browser-video/agent-video-state.js'
import type { BrowserVideoState } from '../src/shared/video.js'

// browser_video returned the full path of a video the person saved through the Save dialog, naming a folder of theirs.
const downloads = join('/', 'home', 'person', 'Downloads')
const saved = (path: string): BrowserVideoState => ({
  exported: { filename: 'hronaut-video.webm', path, bytes: 10, mimeType: 'video/webm', codec: 'vp9', durationMs: 1000 }
} as BrowserVideoState)

it('keeps a video in the download folder with its path, and one the person saved elsewhere without it', () => {
  expect(agentVideoState(saved(join(downloads, 'hronaut-video.webm')), downloads).exported?.path).toBe(join(downloads, 'hronaut-video.webm'))
  for (const elsewhere of [join('/', 'home', 'person', 'Private', 'hronaut-video.webm'), join(downloads, '..', 'Downloads2', 'hronaut-video.webm'), downloads]) {
    const exported = agentVideoState(saved(elsewhere), downloads).exported
    expect(exported, elsewhere).toMatchObject({ filename: 'hronaut-video.webm', bytes: 10 })
    expect(exported, elsewhere).not.toHaveProperty('path')
  }
  const idle = { status: 'idle' } as BrowserVideoState
  expect(agentVideoState(idle, downloads)).toBe(idle)
})

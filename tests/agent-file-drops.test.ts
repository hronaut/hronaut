import type { WebContents } from 'electron'
import { describe, expect, it } from 'vitest'
import { agentFileDropUnanswered, markAgentFileDrop } from '../src/main/browser/file-drop/agent-file-drops.js'

// A page whose drop handler held an agent's file drop past the drop's wait showed the person an error once Chromium
// went on to open the file the page did not take.

describe('an agent\'s file drop Chromium has yet to answer', () => {
  it('marks its page until Chromium answers every such drop, whether it took or refused it', async () => {
    const page = {} as WebContents
    let answerFirst!: () => void
    let refuseSecond!: (error: Error) => void
    markAgentFileDrop(page, new Promise<void>((resolve) => { answerFirst = resolve }))
    markAgentFileDrop(page, new Promise<void>((_resolve, reject) => { refuseSecond = reject }))

    expect(agentFileDropUnanswered(page)).toBe(true)
    expect(agentFileDropUnanswered({} as WebContents)).toBe(false)
    answerFirst()
    await Promise.resolve()
    expect(agentFileDropUnanswered(page)).toBe(true)
    refuseSecond(new Error('The page closed'))
    await Promise.resolve()
    expect(agentFileDropUnanswered(page)).toBe(false)
  })
})

import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ webContents: { getFocusedWebContents: () => null } }))
vi.mock('../src/main/browser/agent-input-scope/focus-isolation.js', () => ({
  beginAgentFocusIsolation: () => () => undefined,
  restoreHumanFocusAfterAgentInput: () => undefined
}))

const { withAgentInput } = await import('../src/main/browser/agent-input-scope/agent-input-scope.js')
const { watchCredentialSubmission } = await import('../src/main/browser/credential-capture/credential-capture.js')
const { guardPageCallsDuringWebsiteDialog } = await import('../src/main/browser/website-dialog-guard.js')

/** A page whose calls the website dialog guard holds, recording the scripts that reach it. */
function pageWithDialogs() {
  const scripts: string[] = []
  let finishWatch = (_candidate: unknown): void => undefined
  const debuggerEvents = new EventEmitter()
  // The watch for a submitted sign-in form answers once the person submits one.
  const watches = vi.fn(() => new Promise((resolve) => { finishWatch = resolve }))
  const page = Object.assign(new EventEmitter(), {
    id: 7,
    isDestroyed: () => false,
    executeJavaScript: vi.fn(async (script: string) => { scripts.push(script); return true }),
    executeJavaScriptInIsolatedWorld: watches,
    debugger: Object.assign(debuggerEvents, { sendCommand: vi.fn(async () => ({})) })
  })
  guardPageCallsDuringWebsiteDialog(page as never, () => false)
  /** The page opens a confirm, and Electron shows its box for it in the next turn. */
  const dialogOpens = async (): Promise<void> => {
    debuggerEvents.emit('message', {}, 'Page.javascriptDialogOpening', { type: 'confirm', message: 'Delete it?' })
    await new Promise(resolve => setImmediate(resolve))
  }
  const dialogCloses = (): void => { debuggerEvents.emit('message', {}, 'Page.javascriptDialogClosed', { result: true }) }
  return { page, scripts, watches, dialogOpens, dialogCloses, submit: (candidate: unknown) => finishWatch(candidate) }
}

/** A browser showing the page in its one tab, with nothing focused. */
function agentInputBrowser() {
  const agentInput = new Map<number, number>()
  const tab = { id: 'tab' }
  return {
    agentInput,
    browser: {
      window: { isFocused: () => false },
      agentInputWebContents: agentInput,
      agentInputFocusSnapshots: new Map(),
      agentInputFocusGuardReleases: new Map(),
      tabs: new Map([[tab.id, tab]]),
      webContentsToTab: new Map([[7, tab.id]]),
      isHumanInteractionLocked: () => false
    }
  }
}

const SET_FLAG = 'window.__hronautAgentInputActive = true'
const CLEAR_FLAG = 'delete window.__hronautAgentInputActive'

describe('page work around a website dialog', () => {
  // Chromium drops input to a page its dialog holds, so a later key press or click reached nothing yet read as done.
  it('refuses an agent\'s input unsent while a website dialog holds the page', async () => {
    const { page, scripts, dialogOpens } = pageWithDialogs()
    const { browser, agentInput } = agentInputBrowser()
    await dialogOpens()
    const operation = vi.fn(async () => 'pressed')
    await expect(withAgentInput(browser as never, page as never, operation)).rejects.toMatchObject({ name: 'WebsiteDialogOpenError', sent: false })
    expect(operation).not.toHaveBeenCalled()
    expect(scripts).toEqual([])
    expect(agentInput.size).toBe(0)
  })

  it('clears the agent input flag once the website dialog the agent\'s input opened closes', async () => {
    const { page, scripts, dialogOpens, dialogCloses } = pageWithDialogs()
    const { browser } = agentInputBrowser()
    await expect(withAgentInput(browser as never, page as never, async () => {
      await dialogOpens()
      return 'pressed'
    })).resolves.toBe('pressed')
    expect(scripts).toEqual([SET_FLAG])
    dialogCloses()
    await vi.waitFor(() => expect(scripts).toEqual([SET_FLAG, CLEAR_FLAG]))
  })

  // A sign-in page that alerted "Wrong password" lost its watch, so the next, correct sign-in offered no password save.
  it('keeps watching for a submitted sign-in form through a website dialog', async () => {
    const { page, watches, dialogOpens, dialogCloses, submit } = pageWithDialogs()
    const onCredentialSubmitted = vi.fn()
    const tab = { url: 'https://example.test/sign-in', webContents: page, lastHumanInteractionAt: performance.now() }
    watchCredentialSubmission({ options: { onCredentialSubmitted } } as never, tab as never)
    await dialogOpens()
    dialogCloses()
    submit({ origin: 'https://example.test', username: 'ada', password: 'correct horse' })
    await vi.waitFor(() => expect(onCredentialSubmitted).toHaveBeenCalledWith({ origin: 'https://example.test', username: 'ada', password: 'correct horse' }))
    // It watches again after the submission.
    expect(watches).toHaveBeenCalledTimes(2)
  })
})

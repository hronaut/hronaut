import { expect, type ElectronApplication } from '@playwright/test'

export type HoldFailure = 'none' | 'down-ack' | 'release' | 'relock' | 'persistent-relock' | 'emergency-preparation' | 'final-restoration' | 'before-down' | 'delayed-ack'
export type HoldProbe = {
  pageId: number
  commands: Array<{ type: string; key: string; at: number; params: Record<string, unknown> }>
  upAcknowledged: boolean
  downAcknowledged: boolean
  ready: boolean
  unlocks: number
  relocks: number
  injected: boolean
  release: () => void
  restore: () => void
}
export type HoldScope = typeof globalThis & { holdProbe?: HoldProbe }

export async function setupHoldPage(app: ElectronApplication, url: string): Promise<void> {
  await waitForSettledPageBounds(app, url)
  await app.evaluate(async ({ webContents }, url) => {
    const page = webContents.getAllWebContents().find(p => p.getURL() === url)!
    await page.executeJavaScript(`document.body.innerHTML='<canvas id="canvas" tabindex="0" width="400" height="200"></canvas><input id="text">';window.holdEffects={events:[],held:false,frames:0};for(const type of ['keydown','keyup'])document.addEventListener(type,e=>{window.holdEffects.events.push({type,key:e.key,code:e.code,repeat:e.repeat,trusted:e.isTrusted,time:performance.now(),wallTime:Date.now()});if(e.key==='ArrowRight'){window.holdEffects.held=type==='keydown';e.preventDefault()}});function frame(){if(window.holdEffects.held){window.holdEffects.frames++;const ctx=document.querySelector('canvas').getContext('2d');ctx.fillRect(window.holdEffects.frames%390,10,10,10)}requestAnimationFrame(frame)}requestAnimationFrame(frame);document.querySelector('canvas').focus();void 0`)
  }, url)
}

/**
 * A hold refuses to start when main moves its page, and the toolbar can still
 * be settling just after a tab is selected. Wait until the page's bounds stop
 * changing so a hold sees only the movement a test causes.
 */
async function waitForSettledPageBounds(app: ElectronApplication, url: string): Promise<void> {
  let last: string | undefined
  let since = Date.now()
  await expect.poll(async () => {
    const bounds = await app.evaluate(({ BrowserWindow, WebContentsView }, url) => BrowserWindow.getAllWindows()
      .flatMap(window => window.contentView.children)
      .find(view => view instanceof WebContentsView && view.webContents.getURL() === url)?.getBounds(), url)
    const current = JSON.stringify(bounds)
    if (current !== last) { last = current; since = Date.now() }
    return bounds ? Date.now() - since : 0
  }, { message: 'the page stops moving', intervals: [100] }).toBeGreaterThanOrEqual(500)
}

export async function observeHold(app: ElectronApplication, url: string, failure: HoldFailure = 'none'): Promise<void> {
  await app.evaluate(({ webContents }, { url, failure }) => {
    const page = webContents.getAllWebContents().find(p => p.getURL() === url)!
    const original = page.debugger.sendCommand
    let release!: () => void
    const barrier = new Promise<void>(resolve => { release = resolve })
    const probe: HoldProbe = {
      pageId: page.id, commands: [], upAcknowledged: false, downAcknowledged: false, ready: false, unlocks: 0, relocks: 0, injected: false, release,
      restore: () => { release(); if (!page.isDestroyed()) page.debugger.sendCommand = original }
    }
    ;(globalThis as HoldScope).holdProbe = probe
    page.debugger.sendCommand = async (method, ...args) => {
      const params = args[0] as Record<string, unknown> | undefined
      if (method === 'Input.setIgnoreInputEvents' && params?.ignore === false) {
        probe.unlocks++
        if (failure === 'emergency-preparation' && probe.downAcknowledged && probe.injected) throw new Error('Controlled emergency-release preparation failure')
        if (failure === 'before-down' && !probe.ready) {
          const result = await original.call(page.debugger, method, ...args)
          probe.ready = true
          await barrier
          return result
        }
      }
      if (method === 'Input.setIgnoreInputEvents' && params?.ignore === true && probe.downAcknowledged) {
        probe.relocks++
        const fail = failure === 'persistent-relock'
          || ((failure === 'relock' || failure === 'emergency-preparation') && !probe.injected)
          || (failure === 'final-restoration' && probe.relocks >= 3)
        if (fail) { probe.injected = true; throw new Error('Controlled key-hold barrier restoration failure') }
      }
      if (method === 'Input.dispatchKeyEvent') {
        probe.commands.push({ type: String(params?.type), key: String(params?.key), at: Date.now(), params: params ?? {} })
        if (failure === 'release' && params?.type === 'keyUp') throw new Error('Controlled raw release failure')
      }
      const result = await original.call(page.debugger, method, ...args)
      if (method === 'Input.dispatchKeyEvent' && params?.type === 'rawKeyDown') {
        probe.downAcknowledged = true
        if (failure === 'down-ack') throw new Error('Controlled lost down acknowledgement after real dispatch')
        if (failure === 'delayed-ack') { probe.ready = true; await barrier }
      }
      if (method === 'Input.dispatchKeyEvent' && params?.type === 'keyUp') probe.upAcknowledged = true
      return result
    }
  }, { url, failure })
}

export async function holdObservation(app: ElectronApplication): Promise<{
  commands: HoldProbe['commands']; destroyed: boolean; upAcknowledged: boolean; unlocks: number; relocks: number; injected: boolean
  effects: { events: Array<{ type: string; key: string; code: string; repeat: boolean; trusted: boolean; time: number; wallTime: number }>; held: boolean; frames: number } | null
}> {
  return app.evaluate(async ({ webContents }) => {
    const p = (globalThis as HoldScope).holdProbe!
    const page = webContents.fromId(p.pageId)
    return { commands: p.commands, destroyed: !page || page.isDestroyed(), upAcknowledged: p.upAcknowledged, unlocks: p.unlocks, relocks: p.relocks, injected: p.injected,
      effects: page && !page.isDestroyed() ? await page.executeJavaScript('window.holdEffects ?? null') : null }
  })
}

export async function restoreHold(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => { (globalThis as HoldScope).holdProbe?.restore(); delete (globalThis as HoldScope).holdProbe }).catch(() => undefined)
}

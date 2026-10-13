import type { ElectronApplication } from '@playwright/test'

export type ReplacementPhase = 'before-acquire' | 'after-move' | 'after-final'
type ReplacementProbe = { timeline: Array<Record<string, unknown>>; replacements: number; restore(): void }
type ReplacementScope = typeof globalThis & { __semanticReplacement?: ReplacementProbe }

/** A controlled fixture boundary, not a claim about asynchronous page-event timing. */
export async function installReplacementProbe(app: ElectronApplication, url: string, phase: ReplacementPhase): Promise<void> {
  await app.evaluate(async ({ webContents }, { url, phase }) => {
    const page = webContents.getAllWebContents().find(p => p.getURL() === url)!
    const send = page.debugger.sendCommand.bind(page.debugger)
    const probe: ReplacementProbe = { timeline: [], replacements: 0, restore: () => { page.debugger.sendCommand = send } }
    ;(globalThis as ReplacementScope).__semanticReplacement = probe
    probe.timeline.push({ event: 'installed', originalConnected: await page.executeJavaScript('window.original.isConnected') })
    const replace = async () => {
      const originalConnected = await page.executeJavaScript(`(() => {
        const current=document.getElementById('target');
        current.replaceWith(current.cloneNode(true));
        return window.original.isConnected;
      })()`)
      probe.replacements++
      probe.timeline.push({ event: 'replace', originalConnected })
    }
    page.debugger.sendCommand = async (method, params, session) => {
      const v = params as Record<string, unknown> | undefined
      const acquire = method === 'Runtime.evaluate' && String(v?.objectGroup).startsWith('hronaut-native-click-')
      const sample = method === 'Runtime.callFunctionOn' && String(v?.functionDeclaration).includes('this.sample')
      const final = sample && (v?.arguments as Array<{ value: unknown }>)[2]?.value === true
      const move = method === 'Input.dispatchMouseEvent' && v?.type === 'mouseMoved'
      if (acquire) {
        if (phase === 'before-acquire' && probe.replacements === 0) await replace()
        probe.timeline.push({ event: 'acquire-start', originalConnected: await page.executeJavaScript('window.original.isConnected') })
      }
      if (method === 'Input.dispatchMouseEvent') probe.timeline.push({ event: 'dispatch', type: v?.type })
      if (sample) probe.timeline.push({ event: 'sample-start', final })
      const result = await send(method, params, session)
      if (acquire) probe.timeline.push({ event: 'acquire-end', originalConnected: await page.executeJavaScript('window.original.isConnected') })
      if (move) {
        probe.timeline.push({ event: 'move-acknowledged' })
        // Complete replacement before returning this operation's move acknowledgement,
        // so the test proves a change after retention and before the first sample.
        if (phase === 'after-move' && probe.replacements === 0) await replace()
      }
      if (sample) {
        probe.timeline.push({ event: 'sample-end', final, value: (result as { result?: { value?: unknown } }).result?.value })
        if (final && phase === 'after-final' && probe.replacements === 0) await replace()
      }
      return result
    }
  }, { url, phase })
}

export async function readReplacementProbe(app: ElectronApplication): Promise<Omit<ReplacementProbe, 'restore'>> {
  return app.evaluate(() => {
    const probe = (globalThis as ReplacementScope).__semanticReplacement!
    return { timeline: probe.timeline, replacements: probe.replacements }
  })
}

export async function restoreReplacementProbe(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => {
    (globalThis as ReplacementScope).__semanticReplacement?.restore()
    delete (globalThis as ReplacementScope).__semanticReplacement
  })
}

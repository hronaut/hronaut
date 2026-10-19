import type { WebContents } from 'electron'
import { LOGPOINT_LIMITS, type LogpointScript } from '../../../shared/logpoint.js'
import type { PageFrames } from './logpoint-frames.js'
import {
  describeScript,
  documentScripts,
  frameScripts,
  loadSourceMap,
  scriptRecord,
  sourceMapBudget,
  type CdpSend,
  type LogpointScriptRecord
} from './logpoint-sources.js'

/** The asynchronous stack depth Hronaut's debugger lease sets when it attaches. */
const ASYNC_STACK_DEPTH = 8
/** Scripts one listing collects. */
const MAX_COLLECTED_SCRIPTS = 10_000

/**
 * Collects the page's scripts while no logpoints are armed: enabling the Debugger domain reports every
 * existing script, and it is turned off again, unless another use keeps it, before any source map is read.
 * A pause meanwhile, such as a debugger statement, is resumed at once.
 */
export async function collectScripts<R>(
  contents: WebContents,
  send: CdpSend,
  whileEnabled: () => Promise<R>,
  keepEnabled: () => boolean
): Promise<{ scripts: LogpointScriptRecord[]; result: R }> {
  const collected = new Map<string, LogpointScriptRecord>()
  const onMessage = (_event: Electron.Event, method: string, params: unknown): void => {
    if (method === 'Debugger.scriptParsed') {
      const script = scriptRecord(params)
      if (script && collected.size < MAX_COLLECTED_SCRIPTS) collected.set(script.scriptId, script)
    } else if (method === 'Debugger.paused') {
      void contents.debugger.sendCommand('Debugger.resume').catch(() => undefined)
    }
  }
  contents.debugger.on('message', onMessage)
  try {
    await send('Debugger.enable')
    const result = await whileEnabled()
    return { scripts: [...collected.values()], result }
  } finally {
    if (!keepEnabled()) {
      await contents.debugger.sendCommand('Debugger.disable').catch(() => undefined)
      await contents.debugger.sendCommand('Runtime.setAsyncCallStackDepth', { maxDepth: ASYNC_STACK_DEPTH }).catch(() => undefined)
    }
    contents.debugger.removeListener('message', onMessage)
  }
}

/** Up to maxScripts of the frames' scripts, each with the sources its source map lists, and how many were left out. */
export async function listScripts(send: CdpSend, known: LogpointScriptRecord[], page: PageFrames): Promise<{ scripts: LogpointScript[]; omittedScripts: number }> {
  const own = documentScripts(known, page.frames)
  const listed = own.slice(0, LOGPOINT_LIMITS.maxScripts)
  const budget = sourceMapBudget()
  const scripts: LogpointScript[] = []
  for (const script of listed) {
    const loaded = !script.sourceMapUrl ? undefined
      : Date.now() < budget.deadline ? await loadSourceMap(send, page.mainFrameId, script, budget) : 'not-checked' as const
    scripts.push(describeScript(script, loaded))
  }
  const unaddressed = frameScripts(known, page.frames).filter(script => script.url === undefined).length
  return { scripts, omittedScripts: unaddressed + own.length - listed.length }
}

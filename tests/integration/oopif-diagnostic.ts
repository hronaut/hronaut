import { mkdir, writeFile } from 'node:fs/promises'

export const diagnosticArm = process.env.HRONAUT_OOPIF_DIAGNOSTIC_ARM === 'native-route-ready' ? 'native-route-ready' : 'baseline'
export const diagnosticEnabled = ['baseline', 'native-route-ready'].includes(process.env.HRONAUT_OOPIF_DIAGNOSTIC_ARM ?? '')

// Runs only in the two synthetic HTTP fixtures. No text, attributes, URL or message payload is recorded.
export function fixtureObserver(role: 'root' | 'child'): string {
  return `<script>(()=>{try{
    const state=window.__oopif={events:[],clicks:0,dropped:0,errors:0,available:true};
    const error=()=>{try{state.errors=Math.min(1000000,state.errors+1)}catch{}};
    const record=(kind,event)=>{try{if(state.events.length>=32){state.dropped=Math.min(1000000,state.dropped+1);return}if(state.events.length<32)state.events.push({kind,role:'${role}',at:Date.now(),stamp:event?.timeStamp??0,target:event?.target?.tagName==='BUTTON'?'button':event?.target===document?'document':'other',x:event?.clientX??0,y:event?.clientY??0,screenX:event?.screenX??0,screenY:event?.screenY??0,trusted:event?.isTrusted===true});}catch{error()}};
    for(const kind of ['pointermove','pointerdown','pointerup','mousemove','mousedown','mouseup','click'])addEventListener(kind,event=>{try{if(kind==='click')state.clicks++;record(kind,event)}catch{error()}},true);
    addEventListener('load',event=>record('load',event));
    document.addEventListener('readystatechange',event=>record(document.readyState,event));
    addEventListener('message',event=>{try{if(event.data==='child-click')record('message-receive',event)}catch{error()}});
    window.__oopifSend=()=>record('message-send');
    record('observer-installed');
  }catch{try{if(window.__oopif){window.__oopif.errors=Math.min(1000000,window.__oopif.errors+1);window.__oopif.available=false}}catch{}}})()</script>`
}

export type PartStatus = 'fulfilled' | 'rejected' | 'timeout'
export async function collectPartial(
  readers: Record<string, () => Promise<Record<string, unknown>>>,
  timeoutMs = 1500
): Promise<{ data: Record<string, unknown>; availability: Record<string, PartStatus>; captureTimes: Record<string, { start: number; end: number }> }> {
  const data: Record<string, unknown> = {}
  const availability: Record<string, PartStatus> = Object.fromEntries(Object.keys(readers).map(key => [key, 'timeout']))
  const captureTimes: Record<string, { start: number; end: number }> = {}
  let active = true
  let timer: ReturnType<typeof setTimeout> | undefined
  const pending = Object.entries(readers).map(async ([key, read]) => {
    captureTimes[key] = { start: Date.now(), end: 0 }
    try {
      const result = await read()
      if (active) { Object.assign(data, result); availability[key] = 'fulfilled'; captureTimes[key]!.end = Date.now() }
    } catch { if (active) { availability[key] = 'rejected'; captureTimes[key]!.end = Date.now() } }
  })
  await Promise.race([Promise.all(pending), new Promise<void>(resolve => { timer = setTimeout(resolve, timeoutMs) })])
  active = false
  clearTimeout(timer)
  for (const key of Object.keys(captureTimes)) if (!captureTimes[key]!.end) captureTimes[key]!.end = Date.now()
  return { data, availability, captureTimes }
}

// Early data survives all final-window failures. All waits occur after the original assertion.
export async function collectWindowed(readers: Record<'native' | 'frames' | 'root' | 'child', (observe: boolean) => Promise<Record<string, unknown>>>): Promise<Record<string, unknown>> {
  const early = await collectPartial(Object.fromEntries(Object.entries(readers).map(([key, read]) => [key, () => read(false)])), 300)
  const starts: Record<string, number> = { root: Date.now(), child: 0, native: 0, frames: 0 }
  const root = Promise.resolve().then(() => { starts.root = Date.now(); return readers.root(true) })
  const child = Promise.resolve().then(() => { starts.child = Date.now(); return readers.child(true) })
  let windowTimer: ReturnType<typeof setTimeout> | undefined
  const windowDone = Promise.race([Promise.allSettled([root, child]), new Promise<void>(resolve => { windowTimer = setTimeout(resolve, 600) })]).finally(() => clearTimeout(windowTimer))
  const final = await collectPartial({
    root: () => root, child: () => child,
    native: async () => { await windowDone; starts.native = Date.now(); return readers.native(true) },
    frames: async () => { await windowDone; starts.frames = Date.now(); return readers.frames(true) }
  })
  for (const key of Object.keys(starts)) final.captureTimes[key]!.start = starts[key]!
  const available = Object.values(final.availability).every(status => status === 'fulfilled')
  return { ...final.data, availability: final.availability, captureTimes: final.captureTimes, available,
    early: { ...early.data, availability: early.availability, captureTimes: early.captureTimes, available: Object.values(early.availability).every(status => status === 'fulfilled') },
    observationAgreement: !available ? 'unavailable' : final.data.settledHits === final.data.childHits ? 'agree' : 'discordant',
    interpretation: 'inconclusive'
  }
}

const kinds = new Set(['pointermove', 'mousemove', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'load', 'loading', 'interactive', 'complete', 'message-receive', 'message-send', 'observer-installed', 'mouseDown', 'mouseUp', 'mouseMove', 'mousePressed', 'mouseReleased', 'mouseMoved'])
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
const number = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e15 ? value : null
const rows = (value: unknown, limit: number): unknown[] => Array.isArray(value) ? value.slice(0, limit) : []
const role = (value: unknown): string => value === 'root' || value === 'child' ? value : 'unknown'

// Reconstruct the entire export; never spread untrusted diagnostic objects.
export function safeDiagnostic(value: unknown, includeEarly = true): string {
  const input = object(value)
  const events = (value: unknown, limit = 32): unknown[] => rows(value, limit).map(value => {
    const event = object(value)
    return { kind: typeof event.kind === 'string' && kinds.has(event.kind) ? event.kind : 'unknown', role: role(event.role), at: number(event.at), stamp: number(event.stamp), target: typeof event.target === 'string' && ['button', 'document', 'other'].includes(event.target) ? event.target : 'unknown', x: number(event.x), y: number(event.y), screenX: number(event.screenX), screenY: number(event.screenY), trusted: typeof event.trusted === 'boolean' ? event.trusted : null, prevented: typeof event.prevented === 'boolean' ? event.prevented : null }
  })
  const frames = (value: unknown): unknown[] => rows(value, 4).map(value => {
    const frame = object(value)
    return { role: role(frame.role), processId: number(frame.processId), routingId: number(frame.routingId) }
  })
  const count = (value: unknown): number | null => typeof value === 'number' && Number.isInteger(value) && value >= 0 ? Math.min(value, 1000000) : null
  const counters = Object.fromEntries(['rootDropped', 'rootErrors', 'childDropped', 'childErrors', 'nativeDropped', 'commandDropped', 'frameDropped', 'observerErrors'].map(key => [key, count(input[key])]))
  const availability = Object.fromEntries(['native', 'root', 'child', 'frames'].map(key => { const status = object(input.availability)[key]; return [key, status === 'fulfilled' || status === 'rejected' || status === 'timeout' ? status : 'unavailable'] }))
  const exportDropped = Object.fromEntries(([['rootEvents', 32], ['childEvents', 32], ['nativeEvents', 32], ['commands', 12], ['frameSamples', 12], ['framesBefore', 4], ['framesAfter', 4]] as const).map(([key, limit]) => [key, Array.isArray(input[key!]) ? Math.min(1000000, Math.max(0, (input[key!] as unknown[]).length - Number(limit))) : 0]))
  const output = JSON.stringify({
    availability, counters, exportDropped,
    interpretation: 'inconclusive',
    observationAgreement: input.observationAgreement === 'agree' || input.observationAgreement === 'discordant' ? input.observationAgreement : 'unavailable',
    captureTimes: Object.fromEntries(['native', 'root', 'child', 'frames'].map(key => { const time = object(object(input.captureTimes)[key]); return [key, { start: number(time.start), end: number(time.end) }] })),
    early: includeEarly && input.early ? JSON.parse(safeDiagnostic(input.early, false)) : undefined,
    rootObserverAvailable: typeof input.rootObserverAvailable === 'boolean' ? input.rootObserverAvailable : null,
    childObserverAvailable: typeof input.childObserverAvailable === 'boolean' ? input.childObserverAvailable : null,
    truncated: Object.values(counters).some(value => value !== null && value >= 1000000) || ['rootDropped', 'childDropped', 'nativeDropped', 'commandDropped', 'frameDropped'].some(key => (counters[key] ?? 0) > 0) || Object.values(exportDropped).some(value => value > 0),
    version: 1, arm: input.arm === 'native-route-ready' ? 'native-route-ready' : 'baseline', retry: number(input.retry),
    assertion: input.assertion === 'passed' ? 'passed' : input.assertion === 'failed' ? 'failed' : 'not-reached',
    available: input.available === true, barrierObserved: input.barrierObserved === true,
    clickStart: number(input.clickStart), clickReturn: number(input.clickReturn), immediateRead: number(input.immediateRead),
    immediateHits: number(input.immediateHits), settledHits: number(input.settledHits), childHits: number(input.childHits), generationDelta: number(input.generationDelta), toolError: input.toolError === true,
    rootEvents: events(input.rootEvents), childEvents: events(input.childEvents), nativeEvents: events(input.nativeEvents), commands: events(input.commands, 12),
    frameSamples: rows(input.frameSamples, 12).map(value => { const sample = object(value); return { at: number(sample.at), frames: frames(sample.frames) } }),
    framesBefore: frames(input.framesBefore), framesAfter: frames(input.framesAfter)
  })
  if (Buffer.byteLength(output) > 65536) return '{"version":1,"available":false}'
  return output
}

export async function saveDiagnostic(value: unknown, retry: number): Promise<void> {
  try {
    if (!Number.isInteger(retry) || retry < 0 || retry > 1) return
    await mkdir('oopif-safe-artifacts', { recursive: true })
    await writeFile(`oopif-safe-artifacts/${diagnosticArm}-${retry}.json`, safeDiagnostic(value), { flag: 'wx' })
  } catch { /* Diagnostic failure cannot replace the original assertion. */ }
}

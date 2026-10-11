import { mkdir, writeFile } from 'node:fs/promises'

export const diagnosticArm = process.env.HRONAUT_OOPIF_DIAGNOSTIC_ARM === 'native-route-ready' ? 'native-route-ready' : 'baseline'
export const diagnosticEnabled = ['baseline', 'native-route-ready'].includes(process.env.HRONAUT_OOPIF_DIAGNOSTIC_ARM ?? '')

// Runs only in the two synthetic HTTP fixtures. No text, attributes, URL or message payload is recorded.
export function fixtureObserver(role: 'root' | 'child'): string {
  return `<script>(()=>{try{
    const state=window.__oopif={events:[],clicks:0};
    const record=(kind,event)=>{try{if(state.events.length<32)state.events.push({kind,role:'${role}',at:Date.now(),stamp:event?.timeStamp??0,target:event?.target?.tagName==='BUTTON'?'button':event?.target===document?'document':'other',x:event?.clientX??0,y:event?.clientY??0,screenX:event?.screenX??0,screenY:event?.screenY??0,trusted:event?.isTrusted===true});}catch{}};
    for(const kind of ['pointermove','pointerdown','pointerup','mousemove','mousedown','mouseup','click'])addEventListener(kind,event=>{try{if(kind==='click')state.clicks++;record(kind,event)}catch{}},true);
    addEventListener('load',event=>record('load',event));
    document.addEventListener('readystatechange',event=>record(document.readyState,event));
    addEventListener('message',event=>{try{if(event.data==='child-click')record('message-receive',event)}catch{}});
    window.__oopifSend=()=>record('message-send');
    record('observer-installed');
  }catch{}})()</script>`
}

const kinds = new Set(['pointermove', 'mousemove', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'load', 'loading', 'interactive', 'complete', 'message-receive', 'message-send', 'observer-installed', 'mouseDown', 'mouseUp', 'mouseMove', 'mousePressed', 'mouseReleased', 'mouseMoved'])
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
const number = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e15 ? value : null
const rows = (value: unknown, limit: number): unknown[] => Array.isArray(value) ? value.slice(0, limit) : []
const role = (value: unknown): string => value === 'root' || value === 'child' ? value : 'unknown'

// Reconstruct the entire export; never spread untrusted diagnostic objects.
export function safeDiagnostic(value: unknown): string {
  const input = object(value)
  const events = (value: unknown, limit = 32): unknown[] => rows(value, limit).map(value => {
    const event = object(value)
    return { kind: typeof event.kind === 'string' && kinds.has(event.kind) ? event.kind : 'unknown', role: role(event.role), at: number(event.at), stamp: number(event.stamp), target: typeof event.target === 'string' && ['button', 'document', 'other'].includes(event.target) ? event.target : 'unknown', x: number(event.x), y: number(event.y), screenX: number(event.screenX), screenY: number(event.screenY), trusted: typeof event.trusted === 'boolean' ? event.trusted : null, prevented: typeof event.prevented === 'boolean' ? event.prevented : null }
  })
  const frames = (value: unknown): unknown[] => rows(value, 4).map(value => {
    const frame = object(value)
    return { role: role(frame.role), processId: number(frame.processId), routingId: number(frame.routingId) }
  })
  const output = JSON.stringify({
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

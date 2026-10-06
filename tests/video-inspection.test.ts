import { afterEach, expect, it, vi } from 'vitest'
import { BrowserVideoRecorder } from '../src/main/browser/video-recorder.js'
import { selectVideoFrames, videoJpegDimensions } from '../src/main/browser/video-inspection-frames.js'
import { videoInspectionSchema } from '../src/shared/video-inspection.js'

function jpeg(width = 64, height = 32): Uint8Array {
  return new Uint8Array([255,216,255,192,0,17,8,height >> 8,height & 255,width >> 8,width & 255,3,1,17,0,2,17,0,3,17,0,255,218,0,12,3,1,0,2,17,3,17,0,63,0,1,255,217])
}
afterEach(() => vi.useRealTimers())
it('samples actual source timestamps deterministically and exposes a retained state on narrowing', () => {
  const frames = [0,83,166,249,332,415,498,581,664,1800,1927,2054,2181,2308,2435,2562,2689,2816].map(timeMs => ({ timeMs, data: jpeg() }))
  const broad = selectVideoFrames(frames, 0, 3000, 4)
  expect(broad.retained).toBe(18)
  expect(broad.frames.map(frame => frame.sequence)).toEqual([1,6,12,18])
  expect(selectVideoFrames(frames, 249, 249, 12).frames[0]).toMatchObject({ sequence: 4, sourceTimeMs: 249 })
  expect(selectVideoFrames(frames, 700, 1700, 12)).toEqual({ retained: 0, frames: [] })
  expect(selectVideoFrames(frames, 0, 3000, 1).frames[0]?.sequence).toBe(9)
  expect(broad.frames[0]?.data).toBe(frames[0]?.data)
})
it('requires explicit identity, revision and bounded interval/count with no composition arguments', () => {
  const input = { action: 'inspect', recordingId: crypto.randomUUID(), expectedRevision: 1, startMs: 0, endMs: 100, maxFrames: 12 }
  expect(videoInspectionSchema.parse(input)).toEqual(input)
  for (const change of [{ recordingId: undefined }, { expectedRevision: undefined }, { startMs: undefined }, { maxFrames: undefined }, { maxFrames: 13 }, { endMs: -1 }, { startMs: 101 }, { annotations: [] }]) expect(() => videoInspectionSchema.parse({ ...input, ...change })).toThrow()
})
it('bounds JPEG header scanning, source dimensions and aggregate selected bytes before decoding', () => {
  expect(videoJpegDimensions(jpeg())).toEqual({ width: 64, height: 32 })
  for (const invalid of [jpeg(1281), jpeg(64,721), jpeg(0), jpeg().subarray(0,15), new Uint8Array(4*1024*1024+1)]) expect(() => videoJpegDimensions(invalid)).toThrow()
  const duplicate = new Uint8Array([...jpeg().subarray(0,21), ...jpeg().subarray(2)])
  expect(() => videoJpegDimensions(duplicate)).toThrow()
  const padded = new Uint8Array(3*1024*1024); padded.set(jpeg().subarray(0,35)); padded.set([255,217],padded.length-2)
  expect(() => selectVideoFrames([0,1,2].map(timeMs=>({timeMs,data:padded})),0,2,3)).toThrow('8 MiB')
})
function fixture() {
  vi.useFakeTimers()
  let clock = 0, valid = true
  const source = Object.freeze({ tabId: 'tab', workspaceId: 'workspace', origin: 'https://fixture.example' })
  const capture = vi.fn(async () => ({ data: jpeg(), width: 64, height: 32 }))
  const inspect = vi.fn(async () => new Uint8Array([1]))
  const recorder = new BrowserVideoRecorder({ now: () => clock, changed: () => {}, inspect, render: async () => new Uint8Array([2]), save: async () => ({ filename:'video.webm',path:'/video.webm' }) })
  const validate = () => { if (!valid) throw new Error('source changed') }
  const manage = (action: 'start'|'stop'|'pause'|'resume'|'clear'|'edit') => recorder.manage('tab', { action },capture,validate,validate,undefined,source)
  const start = async () => { await manage('start');clock+=100;await manage('stop') }
  const request = () => ({ action:'inspect' as const,recordingId:recorder.state('tab').recordingId!,expectedRevision:recorder.state('tab').timing!.revision,startMs:0,endMs:100,maxFrames:12 })
  return { recorder,inspect,source,manage,start,request,invalidate:()=>{valid=false} }
}
it('inspects original retained pixels without recapture, edits, state changes or preview changes', async () => {
  const f=fixture();await f.start()
  const before=f.recorder.state('tab'),authorize=vi.fn()
  const result=await f.recorder.inspect('tab',f.request(),authorize)
  expect(result.report).toMatchObject({ status:'sheet',retainedFrames:1,selectedFrames:1,omittedFrames:0,pixelTime:'unknown',frames:[{sequence:1,sourceTimeMs:0}] })
  expect(authorize).toHaveBeenCalledWith(f.source)
  expect(f.recorder.state('tab')).toEqual(before)
  expect(f.inspect).toHaveBeenCalledOnce()
  result.assertCurrent();result.discard();expect(result.image).toBeUndefined()
  const empty=await f.recorder.inspect('tab',{...f.request(),startMs:1},authorize)
  expect(empty.report.status).toBe('empty');expect(empty.image).toBeUndefined();expect(f.inspect).toHaveBeenCalledOnce()
  f.recorder.destroy()
})
it.each(['clear','clear-new','edit','origin','cancel','authority'] as const)('discards a late inspection after %s', async boundary => {
  const f=fixture();await f.start()
  let resolve!: (value: Uint8Array<ArrayBuffer>)=>void
  f.inspect.mockImplementationOnce(()=>new Promise(r=>{resolve=r}))
  const controller=new AbortController();let allowed=true
  const pending=f.recorder.inspect('tab',f.request(),()=>{if(!allowed)throw Error('revoked')},controller.signal)
  if(boundary==='clear'||boundary==='clear-new')await f.manage('clear')
  if(boundary==='clear-new')await f.start()
  if(boundary==='edit')await f.manage('edit')
  if(boundary==='origin')f.invalidate()
  if(boundary==='cancel')controller.abort()
  if(boundary==='authority')allowed=false
  resolve(new Uint8Array([1]))
  await expect(pending).rejects.toThrow()
  f.recorder.destroy()
})
it('rejects live, stale and out-of-range requests and revalidates after processing', async () => {
  const f=fixture();await f.start();const request=f.request()
  for(const patch of [{recordingId:crypto.randomUUID()},{expectedRevision:0},{endMs:101}])await expect(f.recorder.inspect('tab',{...request,...patch},()=>{})).rejects.toThrow()
  const result=await f.recorder.inspect('tab',request,()=>{})
  await f.manage('edit');expect(()=>result.assertCurrent()).toThrow()
  await f.manage('clear');await f.manage('start');await expect(f.recorder.inspect('tab',f.request(),()=>{})).rejects.toThrow()
  f.recorder.destroy()
})

it('owns captured bytes instead of retaining a mutable capture-provider buffer', async () => {
  let now = 0
  const data = jpeg(), inspect = vi.fn(async () => new Uint8Array([1]))
  const recorder = new BrowserVideoRecorder({ now: () => now, changed: () => {}, inspect, render: async () => new Uint8Array(), save: async () => ({ filename: 'unused', path: '/unused' }) })
  const capture = async () => ({ data, width: 64, height: 32 })
  const source = { tabId: 'tab', workspaceId: 'workspace', origin: 'https://fixture.example' }
  await recorder.manage('tab', { action: 'start' }, capture, () => {}, () => {}, undefined, source)
  now = 100
  await recorder.manage('tab', { action: 'stop' }, capture, () => {})
  const state = recorder.state('tab')
  data[35] = 99
  await recorder.inspect('tab', { action: 'inspect', recordingId: state.recordingId!, expectedRevision: state.timing!.revision, startMs: 0, endMs: 100, maxFrames: 1 }, () => {})
  const received = inspect.mock.calls[0] as unknown as [readonly { data: Uint8Array }[]]
  expect(received[0][0]!.data).not.toBe(data)
  expect(received[0][0]!.data[35]).toBe(1)
  recorder.destroy()
})

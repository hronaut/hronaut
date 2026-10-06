import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { SelectedVideoFrame } from '../src/main/browser/video-inspection-frames.js'
const runtime = vi.hoisted(() => ({ alive: false, exitConfirmed: true, calls: [] as string[], mode: 'normal', abort: undefined as (()=>void)|undefined, output: '' }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class Contents extends EventEmitter {
    getOSProcessId(): number { return 101 }
    setWindowOpenHandler(): void {}
    isDestroyed(): boolean { return !runtime.alive }
    async executeJavaScript(code: string): Promise<unknown> {
      runtime.calls.push(code)
      if(code.includes('.frame') && runtime.mode==='hold')return new Promise(()=>{})
      if(code.includes('.frame') && runtime.mode==='crash'){this.emit('render-process-gone');return new Promise(()=>{})}
      if(code.includes('.finish'))return runtime.output
      return undefined
    }
  }
  return { app: { getAppMetrics: () => runtime.alive || !runtime.exitConfirmed ? [{pid:101}] : [] }, BrowserWindow: class {
    webContents = new Contents()
    constructor(){runtime.alive=true}
    isDestroyed(): boolean { return !runtime.alive }
    destroy(): void { runtime.alive=false }
    async loadFile(): Promise<void> {}
  } }
})
beforeEach(()=>{
  vi.resetModules();vi.useFakeTimers();runtime.alive=false;runtime.exitConfirmed=true;runtime.calls=[];runtime.mode='normal'
  const png=Buffer.alloc(33);Buffer.from('89504e470d0a1a0a','hex').copy(png);png.writeUInt32BE(13,8);png.write('IHDR',12);png.writeUInt32BE(512,16);png.writeUInt32BE(312,20);runtime.output=png.toString('base64')
})
afterEach(()=>vi.useRealTimers())
const frames: SelectedVideoFrame[] = [{data:new Uint8Array([1]),sequence:1,sourceTimeMs:0,width:64,height:32}]
it('validates between every sequential transport and accepts only the expected PNG geometry',async()=>{
  const {inspectVideoFrames}=await import('../src/main/browser/video-inspection.js')
  const validate=vi.fn();const result=await inspectVideoFrames(frames,new AbortController().signal,validate)
  expect(result.byteLength).toBe(33);expect(validate.mock.calls.length).toBeGreaterThan(5)
  expect(runtime.calls.map(code=>code.split('.')[2]?.split('(')[0])).toEqual(['begin','frame','finish'])
  expect(runtime.alive).toBe(false)
  const oversized=Buffer.from(runtime.output,'base64');oversized.writeUInt32BE(9999,16);runtime.output=oversized.toString('base64')
  await expect(inspectVideoFrames(frames,new AbortController().signal,()=>{})).rejects.toThrow('dimensions')
  runtime.output='A'.repeat(4*Math.ceil((4*1024*1024+3)/3))
  await expect(inspectVideoFrames(frames,new AbortController().signal,()=>{})).rejects.toThrow('Invalid video inspection image')
})
it.each(['deadline','abort','authority','crash'] as const)('settles %s, rejects concurrent admission and releases the slot only after exit',async mode=>{
  const {inspectVideoFrames}=await import('../src/main/browser/video-inspection.js')
  runtime.mode=mode==='crash'?'crash':'hold'
  const controller=new AbortController();let current=true
  const pending=inspectVideoFrames(frames,controller.signal,()=>{if(!current)throw Error('authority changed')})
  const rejection=expect(pending).rejects.toThrow()
  await expect(inspectVideoFrames(frames,controller.signal,()=>{})).rejects.toThrow('already running')
  await vi.advanceTimersByTimeAsync(1)
  if(mode==='abort')controller.abort()
  if(mode==='authority')current=false
  await vi.advanceTimersByTimeAsync(mode==='deadline'?5000:100)
  await rejection
  expect(runtime.alive).toBe(false)
  runtime.mode='normal';await expect(inspectVideoFrames(frames,new AbortController().signal,()=>{})).resolves.toBeInstanceOf(Uint8Array)
})
it('keeps admission quarantined when process exit cannot be confirmed',async()=>{
  const {inspectVideoFrames}=await import('../src/main/browser/video-inspection.js')
  runtime.exitConfirmed=false
  const pending=inspectVideoFrames(frames,new AbortController().signal,()=>{})
  const rejection=expect(pending).rejects.toThrow('cleanup is uncertain')
  await vi.advanceTimersByTimeAsync(500)
  await expect(inspectVideoFrames(frames,new AbortController().signal,()=>{})).rejects.toThrow('already running')
  await vi.advanceTimersByTimeAsync(600);await rejection
  runtime.exitConfirmed=true
  await expect(inspectVideoFrames(frames,new AbortController().signal,()=>{})).rejects.toThrow('restart Hronaut')
})

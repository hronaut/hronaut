import { describe, expect, it } from 'vitest'
import { FrameProvenance, committedHttpOrigin, type ObservedFrame } from '../src/main/browser/frame-provenance.js'
const parent = { id: 'parent', loaderId: 'p1', url: 'http://example.test/parent' }
const child = { id: 'child', loaderId: 'c1', parentId: 'parent', url: 'http://example.test/child' }
function commit(p: FrameProvenance, frame: ObservedFrame, status = 200) {
  p.observe('Network.requestWillBeSent', { type:'Document',frameId:frame.id,loaderId:frame.loaderId,requestId:frame.loaderId,request:{url:frame.url} })
  p.observe('Network.responseReceived', {type:'Document',frameId:frame.id,loaderId:frame.loaderId,requestId:frame.loaderId,response:{url:frame.url,status}})
  p.observe('Page.frameNavigated', {frame})
}
describe('frame provenance', () => {
  it('requires observed parent and child history with exact owner and canonical origin', () => {
    const p = new FrameProvenance('session')
    commit(p,child); expect(p.pair(parent,child)).toBe(false)
    commit(p,parent); expect(p.pair(parent,child)).toBe(true)
    const foreign = {...child,loaderId:'foreign',url:'http://example.test:8080/child'}
    commit(p,foreign); expect(p.pair(parent,foreign)).toBe(false)
    expect(committedHttpOrigin('HTTP://EXAMPLE.TEST:80/a')).toBe('http://example.test')
    expect(committedHttpOrigin('data:text/html,x')).toBeUndefined()
  })
  it('never revives a poisoned loader through duplicates or same-document events', () => {
    const p = new FrameProvenance('session');commit(p,parent);commit(p,child)
    p.observe('Page.documentOpened',{frame:child});commit(p,child)
    p.observe('Page.navigatedWithinDocument',{frameId:child.id,url:child.url})
    expect(p.pair(parent,child)).toBe(false)
    const fresh={...child,loaderId:'new'};commit(p,fresh);expect(p.pair(parent,fresh)).toBe(true)
    commit(p,child);expect(p.pair(parent,fresh)).toBe(true)
    p.observe('Page.documentOpened',{frame:parent});expect(p.pair(parent,fresh)).toBe(false)
  })
  it.each([200,404,500])('accepts correlated HTTP %i documents', status => {
    const p=new FrameProvenance('s');commit(p,parent);commit(p,child,status);expect(p.pair(parent,child)).toBe(true)
  })
  it.each([204,205,302])('rejects non-final/non-document HTTP %i',status=>{
    const p=new FrameProvenance('s');commit(p,parent);commit(p,child,status);expect(p.pair(parent,child)).toBe(false)
  })
  it.each(['swap','bfcache','missing','session','overflow','failure'])('fails closed for %s',reason=>{
    const p=new FrameProvenance('s');commit(p,parent);commit(p,child)
    if(reason==='swap')p.observe('Page.frameDetached',{frameId:child.id,reason:'swap'})
    if(reason==='bfcache')p.observe('Page.frameNavigated',{frame:child,type:'BackForwardCacheRestore'})
    if(reason==='missing')p.observe('Page.documentOpened',{frame:{id:child.id}})
    if(reason==='session')p.observe('Page.frameNavigated',{frame:child},'foreign')
    if(reason==='overflow')for(let n=0;n<128;n++)commit(p,{...child,loaderId:'overflow'+n})
    if(reason==='failure')p.observe('Network.loadingFailed',{requestId:child.loaderId})
    commit(p,child);expect(p.pair(parent,child)).toBe(false)
  })
  it('keeps history through dedicated worker sessions, and still fails closed for any other child session', () => {
    const p=new FrameProvenance('s');commit(p,parent);commit(p,child)
    p.observe('Target.attachedToTarget',{sessionId:'worker',targetInfo:{type:'worker',targetId:'w1'}})
    p.observe('Inspector.workerScriptLoaded',{},'worker')
    expect(p.pair(parent,child)).toBe(true)
    // A detached worker session is forgotten, so a later event under that id is a gap again.
    p.observe('Target.detachedFromTarget',{sessionId:'worker'})
    p.observe('Inspector.workerScriptLoaded',{},'worker')
    expect(p.pair(parent,child)).toBe(false)
    const frames=new FrameProvenance('s');commit(frames,parent);commit(frames,child)
    frames.observe('Target.attachedToTarget',{sessionId:'frame',targetInfo:{type:'iframe',targetId:'f1'}})
    frames.observe('Page.frameNavigated',{frame:child},'frame')
    expect(frames.pair(parent,child)).toBe(false)
  })
})

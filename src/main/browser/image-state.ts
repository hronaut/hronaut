import type { BrowserImageState } from '../../shared/types.js'

export const IMAGE_STATE_WORLD_ID = 1022

export function imageStateScript(selector: string, token: string, deadline: number): string {
  return `(() => {
    const selector=${JSON.stringify(selector)},token=${JSON.stringify(token)},deadline=${deadline};
    if(Date.now()>deadline)return {failure:'expired'};
    if(!(document instanceof HTMLDocument))return {failure:'unsupported-document'};
    const doc=document,handles=globalThis.__hronautImageState??=new Map();
    if(handles.size>=8)return {failure:'busy'};
    const query=Document.prototype.querySelectorAll,createWalker=Document.prototype.createTreeWalker,next=TreeWalker.prototype.nextNode;
    const lookup=()=>{
      const walker=Reflect.apply(createWalker,doc,[doc,NodeFilter.SHOW_ELEMENT]);let count=0;
      while(Reflect.apply(next,walker,[])){if(++count>5000)return {failure:'document-limit'}};
      try{return Reflect.apply(query,doc,[selector])}catch{return {failure:'invalid-selector'}};
    };
    const matches=lookup();if(matches.failure)return matches;
    if(matches.length===0)return {failure:'missing-target'};
    if(matches.length!==1)return {failure:'ambiguous-target'};
    const element=matches[0];
    if(!(element instanceof HTMLImageElement)||!element.isConnected||element.getRootNode()!==doc)return {failure:'unsupported-target'};
    const read=name=>{
      const getter=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,name)?.get;
      if(typeof getter!=='function')throw Error();return Reflect.apply(getter,element,[]);
    };
    let timer;const cleanup=()=>{clearTimeout(timer);handles.delete(token)};
    try{
      const complete=read('complete'),naturalWidth=read('naturalWidth'),naturalHeight=read('naturalHeight'),source=read('currentSrc');
      if(typeof complete!=='boolean'||typeof source!=='string'||![naturalWidth,naturalHeight].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=4294967295))throw Error();
      // Native currentSrc can materialize a large string here. Only its boolean
      // reduction crosses IPC; this is not a pre-allocation or CPU bound.
      const result={observedAt:Date.now(),complete,naturalWidth,naturalHeight,hasSelectedSource:source.length!==0};
      const settle=()=>{try{
        if(Date.now()>deadline||document!==doc)return false;
        const current=lookup();return !current.failure&&element.isConnected&&element.getRootNode()===doc&&current.length===1&&current[0]===element;
      }finally{cleanup()}};
      timer=setTimeout(cleanup,Math.max(1,deadline-Date.now()));handles.set(token,{settle,cleanup});return result;
    }catch{cleanup();return {failure:'native-unavailable'}}
  })()`
}

export function imageStateSettlementScript(token: string, cancel = false): string {
  return `(() => {const handle=globalThis.__hronautImageState?.get(${JSON.stringify(token)});${cancel ? 'handle?.cleanup();return false' : 'return handle?handle.settle():false'}})()`
}

export function normalizeImageState(raw: unknown): BrowserImageState {
  const invalid = () => { throw new Error('Image state unavailable: invalid native report') }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid()
  const value = raw as Record<string, unknown>
  const failures: Record<string, string> = {
    expired: 'Image state inspection expired', busy: 'Image state unavailable: inspection busy',
    'document-limit': 'Image state requires at most 5000 light-DOM elements',
    'invalid-selector': 'Image state requires a valid selector',
    'missing-target': 'Image state target not found', 'ambiguous-target': 'Image state requires one unique current target',
    'unsupported-document': 'Image state requires an HTML document',
    'unsupported-target': 'Image state unsupported: select a top-level HTML image element',
    'native-unavailable': 'Image state unavailable: native scalar acquisition failed'
  }
  if (Object.keys(value).length === 1 && typeof value.failure === 'string' && Object.hasOwn(failures, value.failure)) throw new Error(failures[value.failure])
  const keys = ['observedAt', 'complete', 'naturalWidth', 'naturalHeight', 'hasSelectedSource']
  if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) return invalid()
  const integer = (name: string, max: number) => typeof value[name] === 'number' && Number.isSafeInteger(value[name]) && value[name] >= 0 && value[name] <= max
  if (!integer('observedAt', Number.MAX_SAFE_INTEGER) || !integer('naturalWidth', 4294967295) || !integer('naturalHeight', 4294967295)
    || typeof value.complete !== 'boolean' || typeof value.hasSelectedSource !== 'boolean' || JSON.stringify(value).length > 512) return invalid()
  return value as unknown as BrowserImageState
}

/** Main-owned admission includes native work still pending after caller timeout. */
export class ImageInspectionSlots {
  private readonly counts = new WeakMap<object, number>()
  acquire(owner: object): { track<T>(operation: Promise<T>): Promise<T>; close(cleanup?: Promise<unknown>): void } {
    const count = this.counts.get(owner) ?? 0
    if (count >= 8) throw new Error('Image state unavailable: inspection busy')
    this.counts.set(owner, count + 1)
    let pending = 0, closed = false, released = false
    const release = () => {
      if (!closed || pending || released) return
      released = true
      const remaining = (this.counts.get(owner) ?? 1) - 1
      if (remaining) this.counts.set(owner, remaining); else this.counts.delete(owner)
    }
    const track = <T>(operation: Promise<T>): Promise<T> => {
      pending++
      void operation.then(() => { pending--; release() }, () => { pending--; release() })
      return operation
    }
    return { track, close: cleanup => {
      if (closed) return
      if (cleanup) track(cleanup)
      closed = true; release()
    } }
  }
}

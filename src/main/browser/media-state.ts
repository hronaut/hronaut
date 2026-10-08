import type { BrowserMediaState } from '../../shared/types.js'

export const MEDIA_STATE_WORLD_ID = 1020

// Only native scalar values are reduced in the isolated world, before IPC.
// No source URL, error message, track, metadata or media content is acquired.
export function mediaStateScript(target: { ref?: string; selector?: string }, token: string): string {
  return `(() => {
    const target=${JSON.stringify(target)},token=${JSON.stringify(token)};
    const handles=globalThis.__hronautMediaState??=new Map();
    if(handles.size>=8)return {failure:'busy'};
    const selector=target.ref?'[data-hronaut-ref="'+CSS.escape(target.ref)+'"]':target.selector;
    let matches;try{matches=document.querySelectorAll(selector)}catch{return {failure:'invalid-selector'}};
    if(matches.length!==1)return {failure:'non-unique-target'};
    const element=matches[0];
    if(!(element instanceof HTMLMediaElement)||!element.isConnected||element.getRootNode()!==document)
      return {failure:'unsupported-target'};
    const read=name=>{
      const getter=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,name)?.get;
      if(typeof getter!=='function')throw Error('Media state unavailable: native accessor');
      return Reflect.apply(getter,element,[]);
    };
    const boolean=name=>{const value=read(name);if(typeof value!=='boolean')throw Error('Media state unavailable: invalid scalar');return value};
    const number=(name,min,max,integer=false)=>{const value=read(name);if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max||(integer&&!Number.isInteger(value)))throw Error('Media state unavailable: invalid scalar');return value};
    let dirty=false;
    const observer=new MutationObserver(()=>{dirty=true;observer.disconnect()});
    // Reject detach/reinsert and replacement, including ABA, without retaining mutation records.
    observer.observe(document,{subtree:true,childList:true,attributes:true});
    let timer;
    const cleanup=()=>{observer.disconnect();clearTimeout(timer);handles.delete(token)};
    try {
      const rawDuration=read('duration');
      let duration;
      if(Number.isNaN(rawDuration))duration={state:'unknown'};
      else if(rawDuration===Infinity)duration={state:'infinite'};
      else if(typeof rawDuration==='number'&&Number.isFinite(rawDuration)&&rawDuration>=0&&rawDuration<=Number.MAX_SAFE_INTEGER)duration={state:'finite',seconds:rawDuration};
      else throw Error('Media state unavailable: invalid duration');
      const nativeError=read('error');let errorCode=null;
      if(nativeError!==null){
        const getter=Object.getOwnPropertyDescriptor(MediaError.prototype,'code')?.get;
        if(typeof getter!=='function')throw Error('Media state unavailable: native error accessor');
        errorCode=Reflect.apply(getter,nativeError,[]);
        if(!Number.isInteger(errorCode)||errorCode<1||errorCode>4)throw Error('Media state unavailable: invalid error code');
      }
      const result={kind:element instanceof HTMLVideoElement?'video':'audio',observedAt:Date.now(),
        paused:boolean('paused'),ended:boolean('ended'),seeking:boolean('seeking'),muted:boolean('muted'),
        volume:number('volume',0,1),playbackRate:number('playbackRate',-1024,1024),currentTime:number('currentTime',0,Number.MAX_SAFE_INTEGER),
        duration,readyState:number('readyState',0,4,true),networkState:number('networkState',0,3,true),errorCode};
      if(JSON.stringify(result).length>1024)throw Error('Media state unavailable: output limit');
      const settle=()=>{try{
        const changed=dirty||observer.takeRecords().length>0;
        const current=document.querySelectorAll(selector);
        return !changed&&element.isConnected&&element.getRootNode()===document&&current.length===1&&current[0]===element;
      }finally{cleanup()}};
      timer=setTimeout(cleanup,5000);handles.set(token,{settle,cleanup});return result;
    } catch { cleanup();return {failure:'native-unavailable'} }
  })()`
}

export function mediaStateSettlementScript(token: string, cancel = false): string {
  return `(() => {const handle=globalThis.__hronautMediaState?.get(${JSON.stringify(token)});${cancel ? 'handle?.cleanup();return false' : 'return handle?handle.settle():false'}})()`
}

export function normalizeMediaState(raw: unknown): BrowserMediaState {
  const invalid = () => { throw new Error('Media state unavailable: invalid native report') }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid()
  const value = raw as Record<string, unknown>
  if (Object.keys(value).length === 1 && typeof value.failure === 'string') {
    const failures: Record<string, string> = {
      busy: 'Media state unavailable: inspection busy',
      'invalid-selector': 'Media state requires a valid selector',
      'non-unique-target': 'Media state requires one unique current target',
      'unsupported-target': 'Media state unsupported: select a top-level audio or video element',
      'native-unavailable': 'Media state unavailable: native scalar acquisition failed'
    }
    if (Object.hasOwn(failures, value.failure)) throw new Error(failures[value.failure])
  }
  const keys = ['kind', 'observedAt', 'paused', 'ended', 'seeking', 'muted', 'volume', 'playbackRate', 'currentTime', 'duration', 'readyState', 'networkState', 'errorCode']
  if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) return invalid()
  const finite = (name: string, min: number, max: number, integer = false) => {
    const item = value[name]
    return typeof item === 'number' && Number.isFinite(item) && item >= min && item <= max && (!integer || Number.isInteger(item))
  }
  if (!['audio', 'video'].includes(value.kind as string) || !finite('observedAt', 0, Number.MAX_SAFE_INTEGER, true)
    || ['paused', 'ended', 'seeking', 'muted'].some(key => typeof value[key] !== 'boolean')
    || !finite('volume', 0, 1) || !finite('playbackRate', -1024, 1024) || !finite('currentTime', 0, Number.MAX_SAFE_INTEGER)
    || !finite('readyState', 0, 4, true) || !finite('networkState', 0, 3, true)
    || (value.errorCode !== null && !finite('errorCode', 1, 4, true))) return invalid()
  const duration = value.duration as Record<string, unknown> | null
  if (!duration || typeof duration !== 'object' || Array.isArray(duration)) return invalid()
  if (duration.state === 'finite') {
    if (Object.keys(duration).length !== 2 || typeof duration.seconds !== 'number' || !Number.isFinite(duration.seconds) || duration.seconds < 0 || duration.seconds > Number.MAX_SAFE_INTEGER) return invalid()
  } else if (!['unknown', 'infinite'].includes(duration.state as string) || Object.keys(duration).length !== 1) return invalid()
  if (JSON.stringify(value).length > 1024) return invalid()
  return value as unknown as BrowserMediaState
}

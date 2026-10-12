// Feasibility only: no production API or publication guarantee is claimed.
export const FIELD_COMPARISON_WORLD_ID = 1022
export function comparisonScript(selector: string, expected: string, token: string): string {
  if (typeof selector !== 'string' || !selector.trim() || selector.length > 1000) throw new TypeError('Unsupported selector')
  if (typeof expected !== 'string' || expected.length > 4096) throw new TypeError('Unsupported expected value')
  return `(() => {
    const selector=${JSON.stringify(selector)},expected=${JSON.stringify(expected)},token=${JSON.stringify(token)};
    const handles=globalThis.__hronautFieldComparison??=new Map();
    const unavailable=reason=>({status:'unavailable',reason,observedAt:Date.now()});
    if(handles.size>=8)return unavailable('busy');
    let matches;try{matches=document.querySelectorAll(selector)}catch{return unavailable('invalid-selector')};
    if(matches.length!==1)return unavailable('non-unique-target');
    const element=matches[0];
    const prototype=element instanceof HTMLInputElement?HTMLInputElement.prototype:element instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:null;
    const read=(prototype,object,name)=>{
      const getter=Object.getOwnPropertyDescriptor(prototype,name)?.get;
      if(typeof getter!=='function')throw Error('Native accessor unavailable');
      return Reflect.apply(getter,object,[]);
    };
    const uncustomized=()=>{
      if(!prototype)return false;
      try{Reflect.apply(HTMLElement.prototype.attachInternals,element,[]);return false}
      catch(error){return error instanceof DOMException
        &&read(DOMException.prototype,error,'name')==='NotSupportedError'
        &&read(DOMException.prototype,error,'message')===
          "Failed to execute 'attachInternals' on 'HTMLElement': Unable to attach ElementInternals to non-custom elements."}
    };
    const eligible=()=>Boolean(prototype)&&element.isConnected&&element.getRootNode()===document
      &&!element.hasAttribute('is')&&!element.hasAttribute('hidden')&&!element.isContentEditable
      &&uncustomized()
      &&(!(element instanceof HTMLInputElement)||read(HTMLInputElement.prototype,element,'type')==='text')
      &&!/(?:^|\\s)(?:one-time-code|cc-\\S+)(?:\\s|$)/i.test(element.getAttribute('autocomplete')||'')
      &&element.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})
      &&element.getBoundingClientRect().width>0&&element.getBoundingClientRect().height>0;
    let dirty=false,timer;
    const observer=new MutationObserver(()=>{dirty=true;observer.disconnect()});
    observer.observe(document,{subtree:true,childList:true,attributes:true});
    const cleanup=()=>{observer.disconnect();clearTimeout(timer);handles.delete(token)};
    try {
      if(!eligible()){cleanup();return unavailable('unsupported-target')}
      // The native getter may allocate the complete string before this cap.
      // This bounds supported values and output, not native allocation.
      const actual=read(prototype,element,'value');
      const result=typeof actual!=='string'?unavailable('native-unavailable')
        :actual.length>4096?unavailable('value-too-large')
        :{status:actual===expected?'matched':'mismatched',observedAt:Date.now()};
      const settle=()=>{try{
        const changed=dirty||observer.takeRecords().length>0;
        const current=document.querySelectorAll(selector);
        return !changed&&current.length===1&&current[0]===element&&eligible();
      }catch{return false}finally{cleanup()}};
      timer=setTimeout(cleanup,5000);handles.set(token,{settle,cleanup});return result;
    }catch{cleanup();return unavailable('native-unavailable')}
  })()`
}
export function comparisonSettlementScript(token: string, cancel = false): string {
  return `(() => {const handle=globalThis.__hronautFieldComparison?.get(${JSON.stringify(token)});${cancel ? 'handle?.cleanup();return false' : 'return handle?handle.settle():false'}})()`
}

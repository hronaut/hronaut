import { FORM_VALIDITY_FLAGS } from '../../shared/form-validity.js'

// Both entry points accept only the internal randomUUID handle, never page input.
function tokenLiteral(token: string): string {
  if (typeof token !== 'string' || token.length !== 36
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(token)) {
    throw new TypeError('Invalid form validity inspection token')
  }
  return `'${token}'`
}

// Runs in the existing trusted inspection isolated world. Only fixed native
// booleans cross IPC; no value, constraint string or validation message is read.
export function formValiditySource(token: string): string {
  return `(() => {
    const token=${tokenLiteral(token)};
    const handles=globalThis.__hronautFormValidity??=new Map();
    if(handles.size>=8)throw Error('Form validity inspection is busy');
    const matches=document.querySelectorAll(target.selector);
    if(matches.length!==1||matches[0]!==element)throw Error('Form validity requires one unique target');
    const prototype=element instanceof HTMLInputElement?HTMLInputElement.prototype
      :element instanceof HTMLSelectElement?HTMLSelectElement.prototype
      :element instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:null;
    const read=(prototype,object,name)=>{
      const getter=Object.getOwnPropertyDescriptor(prototype,name)?.get;
      if(typeof getter!=='function')throw Error('Native accessor unavailable');
      return Reflect.apply(getter,object,[]);
    };
    // On these three native brands attachInternals must throw before mutation:
    // HTML's steps 1/3 distinguish internal is-value from a non-custom control.
    // Chromium's exact non-custom refusal is the only accepted result. Unknown
    // wording/API behavior fails closed. No validation message or value is read.
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
      &&(!(element instanceof HTMLInputElement)||!['password','file','hidden'].includes(read(HTMLInputElement.prototype,element,'type')))
      &&!/(?:^|\\s)(?:one-time-code|cc-\\S+)(?:\\s|$)/i.test(element.getAttribute('autocomplete')||'')
      &&element.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})
      &&element.getBoundingClientRect().width>0&&element.getBoundingClientRect().height>0;
    let dirty=false,timer;
    const invalidate=()=>{dirty=true;typeObserver.disconnect();treeObserver.disconnect()};
    const typeObserver=new MutationObserver(invalidate),treeObserver=new MutationObserver(invalidate);
    typeObserver.observe(element,{attributes:true,attributeFilter:['type','autocomplete','is','hidden','contenteditable']});
    treeObserver.observe(document,{childList:true,subtree:true});
    const cleanup=()=>{typeObserver.disconnect();treeObserver.disconnect();clearTimeout(timer);handles.delete(token)};
    let wasEligible=false,result={status:'unavailable',reason:'unsupported-target'};
    try {
      wasEligible=eligible();
      if(wasEligible){
        const willValidate=read(prototype,element,'willValidate');
        const nativeValidity=read(prototype,element,'validity');
        if(typeof willValidate!=='boolean')throw Error('Invalid native boolean');
        const validity={};
        for(const key of ${JSON.stringify(FORM_VALIDITY_FLAGS)}){
          const value=read(ValidityState.prototype,nativeValidity,key);
          if(typeof value!=='boolean')throw Error('Invalid native boolean');
          validity[key]=value;
        }
        result={status:'observed',willValidate,validity};
      }
    }catch{result={status:'unavailable',reason:'native-unavailable'}}
    const settle=()=>{try{
      const changed=dirty||typeObserver.takeRecords().length>0||treeObserver.takeRecords().length>0;
      const current=document.querySelectorAll(target.selector);
      return !changed&&element.isConnected&&current.length===1&&current[0]===element&&(!wasEligible||eligible());
    }catch{return false}finally{cleanup()}};
    timer=setTimeout(cleanup,5000);handles.set(token,{settle,cleanup});return result;
  })()`
}

export function formValiditySettlementScript(token: string, cancel = false): string {
  return `(() => {const handle=globalThis.__hronautFormValidity?.get(${tokenLiteral(token)});${cancel ? 'handle?.cleanup();return false' : 'return handle?handle.settle():false'}})()`
}

import { FORM_VALIDITY_FLAGS } from '../../shared/form-validity.js'

// Runs in the existing trusted inspection isolated world. Only fixed native
// booleans cross IPC; no value, constraint string or validation message is read.
export function formValiditySource(token: string): string {
  return `(() => {
    const token=${JSON.stringify(token)};
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
    const eligible=()=>Boolean(prototype)&&element.isConnected&&element.getRootNode()===document
      &&!element.hasAttribute('is')&&!element.hasAttribute('hidden')&&!element.isContentEditable
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
  return `(() => {const handle=globalThis.__hronautFormValidity?.get(${JSON.stringify(token)});${cancel ? 'handle?.cleanup();return false' : 'return handle?handle.settle():false'}})()`
}

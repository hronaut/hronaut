import { javascriptLiteral } from '../../shared/javascript-literal.js'
import { MAX_COMPARED_TEXT_VALUE_LENGTH } from '../../shared/value-comparison.js'

// Both entry points accept only the internal randomUUID handle, never page input.
function tokenLiteral(token: string): string {
  if (typeof token !== 'string' || token.length !== 36
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(token)) {
    throw new TypeError('Invalid value comparison token')
  }
  return `'${token}'`
}

// Runs in the existing trusted inspection isolated world. The native value is
// reduced to match/mismatch there; no value, length, prefix or position leaves
// the page, and the caller's expected text is never echoed.
export function valueComparisonSource(token: string, expected: string): string {
  if (typeof expected !== 'string' || expected.length > MAX_COMPARED_TEXT_VALUE_LENGTH) {
    throw new TypeError('Invalid expected value')
  }
  return `(() => {
    const token=${tokenLiteral(token)},expected=${javascriptLiteral(expected)};
    const handles=globalThis.__hronautValueComparison??=new Map();
    if(handles.size>=8)throw Error('Value comparison is busy');
    const matches=document.querySelectorAll(target.selector);
    if(matches.length!==1||matches[0]!==element)throw Error('Value comparison requires one unique target');
    const prototype=element instanceof HTMLInputElement?HTMLInputElement.prototype
      :element instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:null;
    const read=(prototype,object,name)=>{
      const getter=Object.getOwnPropertyDescriptor(prototype,name)?.get;
      if(typeof getter!=='function')throw Error('Native accessor unavailable');
      return Reflect.apply(getter,object,[]);
    };
    // Same customized built-in refusal as form validity: unknown API behavior fails closed.
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
    const invalidate=()=>{dirty=true;typeObserver.disconnect();treeObserver.disconnect()};
    const typeObserver=new MutationObserver(invalidate),treeObserver=new MutationObserver(invalidate);
    typeObserver.observe(element,{attributes:true,attributeFilter:['type','autocomplete','is','hidden','contenteditable']});
    treeObserver.observe(document,{childList:true,subtree:true});
    const cleanup=()=>{typeObserver.disconnect();treeObserver.disconnect();clearTimeout(timer);handles.delete(token)};
    let wasEligible=false,result={status:'unavailable',reason:'unsupported-target'};
    try {
      wasEligible=eligible();
      if(wasEligible){
        const value=read(prototype,element,'value');
        if(typeof value!=='string')throw Error('Invalid native value');
        result=value.length>${MAX_COMPARED_TEXT_VALUE_LENGTH}?{status:'unavailable',reason:'oversized'}
          :{status:value===expected?'match':'mismatch'};
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

export function valueComparisonSettlementScript(token: string, cancel = false): string {
  return `(() => {const handle=globalThis.__hronautValueComparison?.get(${tokenLiteral(token)});${cancel ? 'handle?.cleanup();return false' : 'return handle?handle.settle():false'}})()`
}

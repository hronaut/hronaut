import { SIZING_INPUT_PROPERTIES, sizingInputValue } from '../../shared/element-sizing-inputs.js'

function literal(token: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(token)) throw new TypeError('Invalid sizing inspection token')
  return JSON.stringify(token)
}

// Count only; do not collect other nodes' attributes, text or styles.
export function sizingLookupSource(): string {
  return `const sizingLookup=()=>{
    if(!(document instanceof HTMLDocument))throw Error('Sizing inputs require an HTML document');
    if(typeof target.selector!=='string'||!target.selector.trim()||target.selector.length>1000)throw Error('Sizing inputs require a bounded selector');
    const walker=document.createTreeWalker(document,NodeFilter.SHOW_ELEMENT);let count=0;
    while(walker.nextNode()){if(++count>5000)throw Error('Sizing inputs require at most 5000 light-DOM elements')};
    const matches=document.querySelectorAll(target.selector);
    if(matches.length!==1)throw Error('Sizing inputs require one unique light-DOM target');
    return matches;
  };`
}

export function sizingInputsSource(token: string): string {
  return `(() => {
    const token=${literal(token)}, handles=globalThis.__hronautSizingInputs??=new Map();
    if(handles.size>=8)throw Error('Sizing inputs inspection is busy');
    const unique=()=>{const matches=sizingLookup();return matches.length===1&&matches[0]===element&&element.isConnected&&element.getRootNode()===document};
    if(!unique())throw Error('Sizing inputs require one unique light-DOM target');
    const parse=${sizingInputValue.toString()};
    const style=getComputedStyle(element),result={};
    for(const property of ${JSON.stringify(SIZING_INPUT_PROPERTIES)})result[property]=parse(property,style.getPropertyValue(property));
    let timer;
    const cleanup=()=>{clearTimeout(timer);handles.delete(token)};
    const settle=()=>{try{return unique()}catch{return false}finally{cleanup()}};
    timer=setTimeout(cleanup,5000);handles.set(token,{settle,cleanup});return result;
  })()`
}

export function sizingInputsSettlementScript(token: string, cancel = false): string {
  return `(() => {const handle=globalThis.__hronautSizingInputs?.get(${literal(token)});${cancel ? 'handle?.cleanup();return false' : 'return handle?handle.settle():false'}})()`
}

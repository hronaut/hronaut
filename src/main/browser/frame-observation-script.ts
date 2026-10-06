/** Runs only in a private parent isolated world, never in a child's main world. */
export function frameObservationScript(selector: string, maxChars: number, expected: string): string {
  return String.raw`(() => {
    const started = performance.now(), omissions = new Set();
    const fail = () => { throw new Error('Frame observation unavailable'); };
    let searched = 0, selected = null, count = 0;
    const search = document.createTreeWalker(document, NodeFilter.SHOW_ELEMENT);
    while (search.nextNode()) {
      if (++searched > 10000 || performance.now()-started > 100) fail();
      if (search.currentNode.matches(${JSON.stringify(selector)})) { selected=search.currentNode; if (++count>1) fail(); }
    }
    if (selected!==${expected} || count!==1 || selected.localName!=='iframe' || selected.hasAttribute('sandbox') || selected.hasAttribute('srcdoc')) fail();
    // This native SOP check is independent of CDP's privileged node access.
    const child = selected.contentDocument;
    if (!child || !child.documentElement) fail();
    const parent=document, root=child.documentElement, ancestors=[];
    for(let e=selected;e;e=e.parentElement) { if(ancestors.length>=100)fail();ancestors.push(e); }
    let invalid=false, mutationWork=0, mutationTime=0;
    const invalidate=()=>{invalid=true;observer.disconnect();};
    const changed=records=>{
      if(invalid)return;
      const start=performance.now();
      const exhausted=()=>++mutationWork>1000 || mutationTime+performance.now()-start>20;
      if(records.length>1000){invalidate();return;}
      for(const r of records){
        if(exhausted()){invalidate();return;}
        for(const n of r.removedNodes){
          if(exhausted()||n===root){invalidate();return;}
          for(const e of ancestors){
            if(exhausted()||n===e||(n.nodeType===1&&n.contains(e))){invalidate();return;}
          }
        }
      }
      mutationTime+=performance.now()-start;
    };
    const observer=new MutationObserver(changed);
    observer.observe(parent,{childList:true,subtree:true});observer.observe(child,{childList:true});
    const check=()=>{
      if(invalid)return false;
      changed(observer.takeRecords());
      return !invalid && document===parent && selected.isConnected && selected.contentDocument===child && child.documentElement===root
        && !selected.hasAttribute('sandbox') && !selected.hasAttribute('srcdoc');
    };
    try {
      const contains=(outer,r)=>r.width>0&&r.height>0&&r.left>=outer.left&&r.top>=outer.top&&r.right<=outer.right&&r.bottom<=outer.bottom;
      const uncertain=s=>s.transform!=='none'||s.rotate!=='none'||s.scale!=='none'||s.translate!=='none'
        ||!['1','normal'].includes(s.zoom)||s.clipPath!=='none'||s.clip!=='auto'||/(?:paint|strict|content)/.test(s.contain)
        ||s.filter!=='none'||s.maskImage!=='none';
      const rounded=s=>[s.borderTopLeftRadius,s.borderTopRightRadius,s.borderBottomLeftRadius,s.borderBottomRightRadius].some(value=>value.split(/\s+/).some(part=>parseFloat(part)!==0));
      const overflowClip=(node,s,clip)=>{
        if(s.overflowX==='visible'&&s.overflowY==='visible')return clip;
        if(rounded(s))return null;
        const r=node.getBoundingClientRect();
        const borders=[s.borderLeftWidth,s.borderRightWidth,s.borderTopWidth,s.borderBottomWidth].map(parseFloat);
        // CSSOM client dimensions round. Reject fractional geometry rather than
        // extending a clipping edge into a border or scrollbar by that rounding.
        if(borders.some(v=>!Number.isInteger(v))||!Number.isInteger(r.width)||!Number.isInteger(r.height))return null;
        const left=r.left+node.clientLeft,top=r.top+node.clientTop;
        return {
          left:s.overflowX==='visible'?clip.left:Math.max(clip.left,left),
          right:s.overflowX==='visible'?clip.right:Math.min(clip.right,left+node.clientWidth),
          top:s.overflowY==='visible'?clip.top:Math.max(clip.top,top),
          bottom:s.overflowY==='visible'?clip.bottom:Math.min(clip.bottom,top+node.clientHeight)
        };
      };
      let parentClip={left:0,top:0,right:innerWidth,bottom:innerHeight};
      const frameRect=selected.getBoundingClientRect();
      for(const e of ancestors){
        const s=getComputedStyle(e);
        if(s.display==='none'||s.visibility!=='visible'||Number(s.opacity)!==1||uncertain(s))fail();
        if(e===selected){
          if(rounded(s)||[s.paddingLeft,s.paddingRight,s.paddingTop,s.paddingBottom].some(value=>parseFloat(value)!==0))fail();
        }else{parentClip=overflowClip(e,s,parentClip);if(!parentClip)fail();}
      }
      if(!contains(parentClip,frameRect))fail();
      const viewport={left:0,top:0,right:selected.clientWidth,bottom:selected.clientHeight};
      const out=[],body=[],semantics=[],labels=new Map();let chars=0,bodyChars=0,visited=0,headings=0,controls=0;
      const clean=v=>String(v||'').replace(/\s+/g,' ').trim();
      const attr=(node,name)=>{const value=node.getAttribute(name)||'';if(value.length>300)omissions.add('semantic-limit');return clean(value.slice(0,300));};
      const safeUrl=node=>{
        const value=node.getAttribute('href')||'';
        if(!value)return '';
        if(value.length>2048){omissions.add('semantic-limit');return '';}
        try{const u=new URL(value,child.baseURI);if(!['http:','https:'].includes(u.protocol))return u.protocol+'//';
          u.username='';u.password='';u.hash='';
          for(const key of [...u.searchParams.keys()])if(/(api[-_]?key|authorization|auth[-_]?token|cookie|credential|csrf|password|passwd|passcode|secret|session|token)/i.test(key))u.searchParams.set(key,'[REDACTED]');
          return u.href;
        }catch{return '';}
      };
      const append=value=>{if(chars+value.length+(out.length?1:0)>${maxChars}){omissions.add('text-limit');return false;}out.push(value);chars+=value.length+(out.length>1?1:0);return true;};
      // One bounded public-text walk supplies body and semantic fallback labels.
      // No innerText, textContent, form values, placeholders or selected options.
      const stack=[{node:root,depth:0,clip:viewport,owners:[]}];
      while(stack.length){
        if(++visited>10000){omissions.add('node-limit');break;}
        if(performance.now()-started>100){omissions.add('duration-limit');break;}
        const {node,depth,clip,owners}=stack.pop();
        if(depth>100){omissions.add('depth-limit');continue;}
        if(node.nodeType===1){
          const tag=node.localName;
          if(['script','style','noscript','template','head'].includes(tag))continue;
          if(node.isContentEditable||node.hasAttribute('contenteditable')&&node.getAttribute('contenteditable')!=='false'){omissions.add('private-editors');continue;}
          if(['iframe','frame','object','embed'].includes(tag)){omissions.add('nested-frames');continue;}
          if(node.shadowRoot)omissions.add('shadow-dom');
          const s=getComputedStyle(node);
          if(s.display==='none'||s.visibility!=='visible'||Number(s.opacity)===0)continue;
          if(uncertain(s)||Number(s.opacity)!==1||s.textOverflow==='ellipsis'||s.webkitLineClamp!=='none'){omissions.add('uncertain-layout');continue;}
          const nextClip=overflowClip(node,s,clip);
          if(!nextClip){omissions.add('uncertain-layout');continue;}
          const role=attr(node,'role'),heading=/^h[1-6]$/.test(tag),control=['a','button','input','textarea','select','summary'].includes(tag)||['button','link','checkbox','radio','tab'].includes(role);
          const rect=node.getBoundingClientRect(),inClip=contains(clip,rect);
          let nextOwners=owners,record;
          if((heading||control)&&!inClip)omissions.add('offscreen-or-clipped');
          if(heading||control||tag==='label'||node.hasAttribute('id')){
            if(labels.size>=1000){omissions.add('semantic-limit');}
            else{
              record={node,text:'',heading,role:role||tag,explicit:attr(node,'aria-label')||attr(node,'title'),inClip};
              labels.set(node,record);nextOwners=[...owners,record];
              if(heading&&inClip){if(++headings<=80)semantics.push(record);else omissions.add('semantic-limit');}
              else if(control&&inClip){if(++controls<=500)semantics.push(record);else omissions.add('semantic-limit');}
            }
          }
          if(['input','textarea','select','option'].includes(tag)){omissions.add('private-editors');continue;}
          for(let n=node.lastChild;n;n=n.previousSibling){if(stack.length>=10000){omissions.add('node-limit');break;}stack.push({node:n,depth:depth+1,clip:nextClip,owners:nextOwners});}
        }else if(node.nodeType===3){
          const range=child.createRange();range.selectNodeContents(node);const boxes=range.getClientRects();
          if(boxes.length>1000){omissions.add('uncertain-layout');continue;}
          if(!boxes.length||!Array.from(boxes).every(r=>contains(clip,r))){omissions.add('offscreen-or-clipped');continue;}
          const value=clean(node.data.slice(0,${maxChars}+1));if(!value)continue;
          for(const owner of owners){
            if(++visited>10000){omissions.add('node-limit');break;}
            const next=owner.text+(owner.text?' ':'')+value;
            if(next.length>300)omissions.add('semantic-limit');owner.text=next.slice(0,300);
          }
          if(bodyChars+value.length+1>${maxChars}){omissions.add('text-limit');break;}
          body.push(value);bodyChars+=value.length+1;
        }
      }
      const boundLabel=value=>{const label=clean(value);if(label.length>300)omissions.add('semantic-limit');return label.slice(0,300);};
      const publicLabel=record=>{
        if(record.explicit)return record.explicit;
        const ids=attr(record.node,'aria-labelledby').split(/\s+/).filter(Boolean);
        if(ids.length>8){omissions.add('semantic-limit');return '';}
        const parts=[];
        for(const id of ids){const target=child.getElementById(id),entry=labels.get(target);if(entry?.inClip)parts.push(entry.text);else omissions.add('semantic-limit');}
        if(parts.length)return boundLabel(parts.join(' '));
        const associated=record.node.labels;
        if(associated){if(associated.length>8)omissions.add('semantic-limit');else for(const label of associated){const entry=labels.get(label);if(entry?.inClip)parts.push(entry.text);else omissions.add('semantic-limit');}}
        return boundLabel(parts.join(' ')||record.text);
      };
      for(const record of semantics){
        if(performance.now()-started>100){omissions.add('duration-limit');break;}
        const node=record.node,label=publicLabel(record);
        if(record.heading){if(!append(node.localName+': '+label))break;continue;}
        let line=record.role+' '+JSON.stringify(label);
        if(node.localName==='a')line+=' href='+JSON.stringify(safeUrl(node));
        if(node.matches(':disabled')||node.getAttribute('aria-disabled')==='true')line+=' disabled';
        if(node.localName==='input'&&['checkbox','radio'].includes(node.type))line+=' checked='+String(node.checked);
        else if(['true','false','mixed'].includes(node.getAttribute('aria-checked')))line+=' checked='+node.getAttribute('aria-checked');
        if(!append(line))break;
      }
      for(const value of body)if(!append(value))break;
      if(!check())fail();
      const result={text:out.join('\n'),omissions:[...omissions]};
      return {frame:selected,read:()=>result,check,close:()=>observer.disconnect()};
    }catch(e){observer.disconnect();throw e;}
  })()`
}

export function frameSelectorScript(selector: string): string {
  return `(() => {const start=performance.now(),walk=document.createTreeWalker(document,NodeFilter.SHOW_ELEMENT);let count=0,visits=0,found;while(walk.nextNode()){if(++visits>10000||performance.now()-start>100)throw Error('Unavailable');if(walk.currentNode.matches(${JSON.stringify(selector)})){found=walk.currentNode;if(++count>1)throw Error('Unavailable')}}if(count!==1||found.localName!=='iframe')throw Error('Unavailable');return found})()`
}

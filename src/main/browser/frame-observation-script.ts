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
    let invalid=false;
    const changed=records=>{
      if(records.length>1000){invalid=true;return;}
      for(const r of records) for(const n of r.removedNodes) {
        if(n===root || ancestors.some(e=>n===e || (n.nodeType===1&&n.contains(e))))invalid=true;
      }
    };
    const observer=new MutationObserver(changed);
    observer.observe(parent,{childList:true,subtree:true});observer.observe(child,{childList:true});
    const check=()=>{
      changed(observer.takeRecords());
      return !invalid && document===parent && selected.isConnected && selected.contentDocument===child && child.documentElement===root
        && !selected.hasAttribute('sandbox') && !selected.hasAttribute('srcdoc');
    };
    try {
      const contains=(outer,r)=>r.width>0&&r.height>0&&r.left>=outer.left&&r.top>=outer.top&&r.right<=outer.right&&r.bottom<=outer.bottom;
      let parentClip={left:0,top:0,right:innerWidth,bottom:innerHeight};
      const frameRect=selected.getBoundingClientRect();
      for(const e of ancestors){
        const s=getComputedStyle(e),r=e.getBoundingClientRect();
        if(s.display==='none'||s.visibility!=='visible'||Number(s.opacity)!==1||s.transform!=='none'||s.clipPath!=='none'||s.clip!=='auto'||/(?:paint|strict|content)/.test(s.contain)||s.filter!=='none'||s.maskImage!=='none')fail();
        if(s.overflowX!=='visible'||s.overflowY!=='visible')parentClip={left:Math.max(parentClip.left,r.left),top:Math.max(parentClip.top,r.top),right:Math.min(parentClip.right,r.right),bottom:Math.min(parentClip.bottom,r.bottom)};
      }
      if(!contains(parentClip,frameRect))fail();
      const viewport={left:0,top:0,right:selected.clientWidth,bottom:selected.clientHeight};
      const out=[];let chars=0,visited=0;
      // Iterative, bounded DFS; never reads innerText, full HTML or form values.
      const stack=[{node:root,depth:0,clip:viewport}];
      while(stack.length){
        if(++visited>10000){omissions.add('node-limit');break;}
        if(performance.now()-started>100){omissions.add('duration-limit');break;}
        const {node,depth,clip}=stack.pop();
        if(depth>100){omissions.add('depth-limit');continue;}
        if(node.nodeType===1){
          const tag=node.localName;
          if(['script','style','noscript','template','head'].includes(tag))continue;
          if(['input','textarea','select','option'].includes(tag)||node.isContentEditable||node.hasAttribute('contenteditable')&&node.getAttribute('contenteditable')!=='false') {omissions.add('private-editors');continue;}
          if(['iframe','frame','object','embed'].includes(tag)){omissions.add('nested-frames');continue;}
          if(node.shadowRoot)omissions.add('shadow-dom');
          const s=getComputedStyle(node);
          if(s.display==='none'||s.visibility!=='visible'||Number(s.opacity)===0)continue;
          if(s.transform!=='none'||s.clipPath!=='none'||s.clip!=='auto'||/(?:paint|strict|content)/.test(s.contain)||s.filter!=='none'||s.maskImage!=='none'||Number(s.opacity)!==1||s.textOverflow==='ellipsis'||s.webkitLineClamp!=='none') {omissions.add('uncertain-layout');continue;}
          const rect=node.getBoundingClientRect();let nextClip=clip;
          if(s.overflowX!=='visible'||s.overflowY!=='visible')nextClip={left:Math.max(clip.left,rect.left),top:Math.max(clip.top,rect.top),right:Math.min(clip.right,rect.right),bottom:Math.min(clip.bottom,rect.bottom)};
          // Cap pending nodes too; do not enumerate an unbounded child list.
          for(let n=node.lastChild;n;n=n.previousSibling){if(stack.length>=10000){omissions.add('node-limit');break;}stack.push({node:n,depth:depth+1,clip:nextClip});}
        } else if(node.nodeType===3){
          const range=child.createRange();range.selectNodeContents(node);
          const boxes=range.getClientRects();
          if(boxes.length>1000){omissions.add('uncertain-layout');continue;}
          if(!boxes.length||!Array.from(boxes).every(r=>contains(clip,r))){omissions.add('offscreen-or-clipped');continue;}
          const value=node.data.slice(0,${maxChars}+1).replace(/\s+/g,' ').trim();
          if(!value)continue;
          const remaining=${maxChars}-chars;
          if(value.length+1>remaining){omissions.add('text-limit');break;}
          out.push(value);chars+=value.length+1;
        }
      }
      if(!check())fail();
      const result={text:out.join('\n'),omissions:[...omissions]};
      return {frame:selected,read:()=>result,check,close:()=>observer.disconnect()};
    } catch(e) {observer.disconnect();throw e;}
  })()`
}

export function frameSelectorScript(selector: string): string {
  return `(() => {const start=performance.now(),walk=document.createTreeWalker(document,NodeFilter.SHOW_ELEMENT);let count=0,visits=0,found;while(walk.nextNode()){if(++visits>10000||performance.now()-start>100)throw Error('Unavailable');if(walk.currentNode.matches(${JSON.stringify(selector)})){found=walk.currentNode;if(++count>1)throw Error('Unavailable')}}if(count!==1||found.localName!=='iframe')throw Error('Unavailable');return found})()`
}

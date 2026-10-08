import { expect, test } from './fixtures.js'

// Discovery only: no production API, no real profile/passwords, no CDP DOM acquisition.
test.use({ trace: 'off', screenshot: 'off', video: 'off' })

test('reduces native password state and rejects synthetic stale targets in an isolated world', async ({ electronApp }) => {
  const proof = await electronApp.evaluate(async ({ BrowserWindow }) => {
    const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'password-occupancy-proof' } })
    const contents = window.webContents
    const setup = `<!doctype html><input id="anchor"><input id="target" type="password"><script>
      globalThis.getterCalls=0;globalThis.events=0;
      for(const type of ['focus','input','change','submit'])document.addEventListener(type,()=>events++,true);
      const nativeValue=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');
      globalThis.seed=()=>nativeValue.set.call(document.getElementById('target'),Array.from(crypto.getRandomValues(new Uint8Array(17)),n=>String.fromCharCode(65+n%26)).join(''));
      globalThis.seedAgain=()=>nativeValue.set.call(document.getElementById('target'),Array.from(crypto.getRandomValues(new Uint8Array(233)),n=>String.fromCharCode(65+n%26)).join(''));
      globalThis.clear=()=>nativeValue.set.call(document.getElementById('target'),'');
      Object.defineProperty(HTMLInputElement.prototype,'value',{get(){getterCalls++;throw Error('page getter must not run')},set:nativeValue.set});
      Object.defineProperty(document.getElementById('target'),'value',{get(){getterCalls++;throw Error('own getter must not run')}});
    </script>`
    const bootstrap = `(() => {
      const valueGetter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').get;
      const typeGetter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'type').get;
      const apply=Reflect.apply;
      let pending;
      const cancel=()=>{pending?.observer.disconnect();pending=undefined};
      globalThis.beginProof=()=>{
        cancel();
        const matches=document.querySelectorAll('#target');
        if(matches.length!==1)return 'unknown';
        const element=matches[0];
        const eligible=()=>element instanceof HTMLInputElement && element.isConnected
          && element.getRootNode()===document && apply(typeGetter,element,[])==='password'
          && element.getClientRects().length>0 && getComputedStyle(element).visibility==='visible';
        if(!eligible())return 'unknown';
        let dirty=false;
        const invalidate=records=>{for(const record of records){
          if(record.type==='attributes' && record.target===element)dirty=true;
          if(record.type==='childList' && [...record.removedNodes].some(node=>node===element || node.contains(element)))dirty=true;
        }};
        const observer=new MutationObserver(invalidate);
        observer.observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['type'],attributeOldValue:true});
        // The native string exists transiently only here. No string/length crosses IPC.
        let state='unknown';try{state=apply(valueGetter,element,[])===''?'empty':'nonempty'}catch{}
        pending={observer,settle:()=>{invalidate(observer.takeRecords());const same=document.querySelectorAll('#target');
          return !dirty && eligible() && same.length===1 && same[0]===element ? state : 'unknown';}};
        return 'pending';
      };
      globalThis.settleProof=()=>{try{return pending?.settle()??'unknown'}finally{cancel()}};
      globalThis.cancelProof=cancel;
    })()`
    let stage = 'load'
    const isolated = (code: string) => contents.executeJavaScriptInIsolatedWorld(1006, [{ code }], false)
    const rows: { scenario: string; state: unknown }[] = []
    try {
      await contents.loadURL('data:text/html,' + encodeURIComponent(setup))
      stage = 'bootstrap'
      await isolated(bootstrap)
      const check = async (scenario: string, mutate?: string) => {
        stage = scenario
        await isolated('beginProof()')
        if (mutate) await contents.executeJavaScript(mutate, false)
        rows.push({ scenario, state: await isolated('settleProof()') })
      }
      await check('empty')
      stage = 'seed'
      await contents.executeJavaScript('seed()', false)
      await check('nonempty')
      await contents.executeJavaScript('seedAgain()', false)
      await check('nonempty-again')
      await contents.executeJavaScript('clear()', false)
      await check('cleared')
      await check('type-aba', `target.type='text';target.type='password'`)
      await check('detach-reattach', `const node=target;node.remove();document.body.append(node)`)
      await check('replacement', `target.replaceWith(target.cloneNode())`)
      await check('ambiguous', `document.body.append(target.cloneNode())`)
      await contents.executeJavaScript(`document.querySelectorAll('#target')[1].remove();target.hidden=true`, false)
      await check('hidden')
      await contents.executeJavaScript(`target.hidden=false;target.type='text'`, false)
      await check('unsupported-text')
      await contents.executeJavaScript(`target.type='password'`, false)
      await isolated('beginProof();cancelProof()')
      rows.push({ scenario: 'cancelled', state: await isolated('settleProof()') })
      const witness = await contents.executeJavaScript('({getterCalls,events,focused:document.activeElement===document.body,x:scrollX,y:scrollY})', false)
      await isolated('beginProof()')
      await contents.loadURL('data:text/html,<input id="target" type="password">')
      rows.push({ scenario: 'navigation', state: await isolated(`typeof settleProof==='function'?settleProof():'unknown'`) })
      return { rows, witness }
    } catch { throw new Error(`Synthetic proof failed at ${stage}`) }
    finally { if (!window.isDestroyed()) window.destroy() }
  })
  expect(proof.rows).toEqual([
    { scenario: 'empty', state: 'empty' }, { scenario: 'nonempty', state: 'nonempty' }, { scenario: 'nonempty-again', state: 'nonempty' }, { scenario: 'cleared', state: 'empty' },
    ...['type-aba', 'detach-reattach', 'replacement', 'ambiguous', 'hidden', 'unsupported-text', 'cancelled', 'navigation'].map(scenario => ({ scenario, state: 'unknown' }))
  ])
  expect(proof.witness).toEqual({ getterCalls: 0, events: 0, focused: true, x: 0, y: 0 })
})

import { writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { ReactInspectionResult } from '../../src/shared/react-inspection.js'
import { decode, expect, rejected, test } from './react-inspection-fixtures.js'

test('captured API and descriptor checks never invoke hostile bindings, inherited values or Error', async ({ react }) => {
  const { page } = react
  await react.enable('/bare-global')
  await page.evaluate(`__REACT_DEVTOOLS_GLOBAL_HOOK__.inject({version:'19.2.4',rendererPackageName:'react-dom'});
    __REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot(1,{current:{tag:0,type:function Captured(){},child:null,sibling:null}});
    window.bindingCanary=0;const api=window.__hronautReactInspection;
    window.globalThis={get __hronautReactInspection(){window.bindingCanary++;return {read:(o,f)=>api.read(o,f),id:o=>api.id(o)}}};void 0`)
  try {
    expect((await react.success<ReactInspectionResult>(react.react('tree'))).status).toBe('ready')
    expect(await page.evaluate('window.bindingCanary')).toBe(0)
    await page.evaluate(`window.addEventListener('hronaut:react-inspection:disable',event=>event.stopImmediatePropagation(),true);
      window.removeEventListener('hronaut:react-inspection:disable',window.__hronautReactInspection.disable,true);
      window.removeEventListener('hronaut:react-inspection:disable',window.__hronautReactInspection.disable,false);void 0`)
    expect((await react.success<ReactInspectionResult>(react.react('disable'))).status).toBe('disabled-reload-required')
    await expect.poll(() => page.evaluate('window.__hronautReactInspection.status().state')).toBe('disabled-reload-required')
    expect(await page.evaluate('window.bindingCanary')).toBe(0)
  } finally { await page.evaluate('window.globalThis=window;void 0') }

  await react.enable('/bare-inherited')
  await page.evaluate(`window.descriptorCanary=0;window.accessorCanary=0;window.errorCanary=0;window.savedError=window.Error;
    __REACT_DEVTOOLS_GLOBAL_HOOK__.inject({version:'19.2.4',rendererPackageName:'react-dom'});
    const fiber={tag:0,type:function OwnDescriptor(){},sibling:null};Object.defineProperty(fiber,'child',{get(){window.accessorCanary++;return null}});
    __REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot(1,{current:fiber});
    Object.defineProperty(Object.prototype,'value',{configurable:true,get(){window.descriptorCanary++;return undefined}});
    window.Error=function(){window.errorCanary++;return new savedError('attacker constructor')};void 0`)
  try {
    expect(rejected(await react.react('tree'))).toBe(true)
    expect(await page.evaluate('[window.descriptorCanary,window.accessorCanary,window.errorCanary]')).toEqual([0, 0, 0])
  } finally { await page.evaluate('delete Object.prototype.value;window.Error=window.savedError;void 0') }

  await react.enable('/bare-intrinsics')
  await page.evaluate(`window.canaryCalls=0;const h=__REACT_DEVTOOLS_GLOBAL_HOOK__;
    h.inject({version:'19.2.4',rendererPackageName:'react-dom'});
    const fiber={tag:0,type:function SafeName(){},child:null,sibling:null};
    for(const field of ['memoizedProps','memoizedState','pendingProps','stateNode','key','_debugSource','dependencies']) Object.defineProperty(fiber,field,{get(){window.canaryCalls++;throw 'excluded'}});
    const root={current:fiber};Object.defineProperty(root,'memoizedState',{get(){window.canaryCalls++;throw 'excluded'}});h.onCommitFiberRoot(1,root);
    window.restoreIntrinsics=(()=>{const desc=Object.getOwnPropertyDescriptor,get=WeakMap.prototype.get,set=WeakMap.prototype.set,has=Set.prototype.has;
      Object.getOwnPropertyDescriptor=WeakMap.prototype.get=WeakMap.prototype.set=Set.prototype.has=()=>{window.canaryCalls++;throw 'altered intrinsic'};
      return ()=>{Object.getOwnPropertyDescriptor=desc;WeakMap.prototype.get=get;WeakMap.prototype.set=set;Set.prototype.has=has};})();void 0`)
  try {
    const result = await react.success<ReactInspectionResult>(react.react('tree'))
    expect(result.nodes.map(node => node.name)).toEqual(['SafeName'])
    expect(await page.evaluate('window.canaryCalls')).toBe(0)
  } finally { await page.evaluate('restoreIntrinsics();void 0') }
  await react.enable('/bare-proxy')
  await page.evaluate(`window.proxyCalls=0;
    __REACT_DEVTOOLS_GLOBAL_HOOK__.inject({version:'19.2.4',rendererPackageName:'react-dom'});
    __REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot(1,new Proxy({},{get(){window.proxyCalls++;throw 'proxy'},getOwnPropertyDescriptor(){window.proxyCalls++;throw 'proxy'}}));void 0`)
  expect(rejected(await react.react('tree'))).toBe(true)
  expect(await page.evaluate('window.proxyCalls')).toBe(0)
})

test('support withdrawal during native traversal cannot publish ready', async ({ react }) => {
  for (const transition of ['renderer', 'root-limit']) {
    await react.enable('/bare-' + transition)
    await react.page.evaluate(`const h=__REACT_DEVTOOLS_GLOBAL_HOOK__;h.inject({version:'19.2.4',rendererPackageName:'react-dom'});
      for(let i=0;i<${transition === 'root-limit' ? 16 : 1};i++)h.onCommitFiberRoot(1,{current:null});void 0`)
    await react.holdRead()
    const pending = react.react('tree')
    await react.entered()
    await react.page.evaluate(transition === 'renderer' ? '__REACT_DEVTOOLS_GLOBAL_HOOK__.inject({});void 0' : '__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot(1,{current:null});void 0')
    await react.release()
    expect(rejected(await pending)).toBe(true)
    expect((await react.success<ReactInspectionResult>(react.react('tree'))).status).toBe(transition === 'renderer' ? 'unsupported-renderer' : 'root-limit')
  }
})

test('actual observer bounds all returned bytes and counts internal fibers', async ({ react }) => {
  for (const scenario of ['nodes', 'depth', 'visits', 'cycle', 'bytes']) {
    await react.enable('/bare-bounds-' + scenario)
    await react.page.evaluate(`const h=__REACT_DEVTOOLS_GLOBAL_HOOK__;h.inject({version:'19.2.4',rendererPackageName:'react-dom'});
      const mode=${JSON.stringify(scenario)};
      const fibers=Array.from({length:300},()=>({tag:mode==='visits'?5:0,type:{displayName:mode==='bytes'?'界'.repeat(80):'N'},child:null,sibling:null}));
      for(let i=0;i<299;i++)fibers[i][mode==='depth'?'child':'sibling']=fibers[i+1];if(mode==='cycle')fibers[0].sibling=fibers[0];
      h.onCommitFiberRoot(1,{current:fibers[0]});void 0`)
    const raw = await react.react('tree')
    expect(raw.isError).not.toBe(true)
    const result = decode<ReactInspectionResult>(raw)
    expect(result.status).toBe('ready')
    expect(result.partial).toBe(true)
    expect(result.limit).toBe(scenario)
    expect(result.nodes.length).toBeLessThanOrEqual(80)
    expect(result.visited).toBeLessThanOrEqual(256)
    expect(Buffer.byteLength(JSON.stringify(raw), 'utf8')).toBeLessThanOrEqual(16000)
    const ids = new Set(result.nodes.map(node => node.id))
    expect(result.nodes.every(node => node.parent === null || ids.has(node.parent))).toBe(true)
  }
})

test('conflicting hook is preserved and never invokes its getter', async ({ react, electronApp, profileDirectory }) => {
  for (const conflict of ['value', 'getter']) {
    const path = join(profileDirectory, 'react-hook-conflict.cjs')
    await writeFile(path, `require('electron').contextBridge.executeInMainWorld({func:()=>{window.conflictCalls=0;window.conflictIdentity=Object.freeze({fixture:true});Object.defineProperty(window,'__REACT_DEVTOOLS_GLOBAL_HOOK__',${conflict === 'getter' ? '{get(){window.conflictCalls++;return window.conflictIdentity}}' : '{value:window.conflictIdentity}'});}});`)
    const identifier = await electronApp.evaluate(({ webContents }, { id, path }) =>
      webContents.fromId(id)!.session.registerPreloadScript({type:'frame',filePath:path}), {id:react.contentsId,path})
    try {
      expect((await react.enable('/bare-conflict-' + conflict)).status).toBe('hook-conflict')
      expect(await react.page.evaluate('window.conflictCalls')).toBe(0)
    } finally {
      await electronApp.evaluate(({ webContents }, { id, identifier }) => {
        webContents.fromId(id)!.session.unregisterPreloadScript(identifier)
      }, {id:react.contentsId,identifier})
      await rm(path, {force:true})
    }
  }
})

test('registration retention is bounded, disabled callbacks stay off, child frames stay uninstrumented', async ({ react }) => {
  await react.enable('/bare-retention')
  await react.page.evaluate(`const h=__REACT_DEVTOOLS_GLOBAL_HOOK__;h.inject({version:'19.2.4',rendererPackageName:'react-dom'});
    for(let i=0;i<1000;i++)h.onCommitFiberRoot(1,{current:null});for(let i=0;i<1000;i++)h.inject({});void 0`)
  expect(await react.page.evaluate('({roots:__hronautReactInspection.status().roots,renderers:__hronautReactInspection.status().renderers})')).toEqual({ roots: 16, renderers: 1 })
  expect((await react.success<ReactInspectionResult>(react.react('tree'))).status).toBe('unsupported-renderer')
  await react.success(react.react('disable'))
  await expect.poll(() => react.page.evaluate('__hronautReactInspection.status().state')).toBe('disabled-reload-required')
  await react.page.evaluate('__REACT_DEVTOOLS_GLOBAL_HOOK__.inject({});__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot(1,{current:null});void 0')
  expect(await react.page.evaluate('({roots:__hronautReactInspection.status().roots,renderers:__hronautReactInspection.status().renderers})')).toEqual({ roots: 0, renderers: 0 })
  expect(rejected(await react.react('tree'))).toBe(true)
  await react.navigate('/bare-disabled')
  expect(await react.page.evaluate('typeof __hronautReactInspection')).toBe('undefined')
  await react.enable('/bare-top-frame')
  await react.page.evaluate(`const f=document.createElement('iframe');f.src='/bare-child';document.body.append(f);void 0`)
  await expect.poll(() => react.page.frames().length).toBe(2)
  await expect.poll(() => react.page.frames()[1]!.url()).toContain('/bare-child')
  expect(await react.page.frames()[1]!.evaluate('typeof __hronautReactInspection')).toBe('undefined')
})

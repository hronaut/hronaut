import { createRequire } from 'node:module'
import vm from 'node:vm'
const require=createRequire('/home/hronom/Dev/hronaut/hronaut/package.json')
const {ref}=require('vue')
const output=await require('esbuild').build({entryPoints:['/home/hronom/Dev/hronaut/hronaut/src/renderer/src/composables/useWorkspaceEditorController.ts'],bundle:true,external:['vue'],platform:'node',format:'cjs',write:false})
const module={exports:{}};vm.runInNewContext(output.outputFiles[0].text,{module,exports:module.exports,require,URL,TextEncoder,window:{setTimeout,clearTimeout}})
let rejectOlder
const pending=new Promise((_,reject)=>{rejectOlder=reject})
const state=ref({mcpTabGroups:[],savedTabGroups:[]})
const open=ref(false)
const c=module.exports.useWorkspaceEditorController({state,open,browser:{getState:()=>pending,listWorkspaceStorageOrigins:async()=>[]},translate:x=>x,formatNumber:String,confirm:()=>true,canPresent:()=>true,syncState:async()=>{}})
const failures=[]
const older=c.openExisting('old').catch(error=>failures.push(error.message))
await c.openNew()
rejectOlder(new Error('Older workspace lookup failed'))
await older
console.log({mode:c.mode.value,open:open.value,reportedFailures:failures})
c.dispose()

// Explicit host-only synthetic proof. Not part of browser capture or default CI.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, copyFileSync, statSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { dockerEngine, isolatedContainer } from '../../scripts/diagnostics/protocol-capture-container.ts'

const image = process.env.HRONAUT_PROTOCOL_TEST_IMAGE
if (!image || !/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error('Pinned local image ID required')
const pause = () => new Promise(resolve => setTimeout(resolve, 25))
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 5000
  while (!predicate()) { if (Date.now() > deadline) throw new Error('Synthetic readiness deadline'); await pause() }
}
test('cancellation kills a detached grandchild via private container PID namespace before copy removal', async () => {
  const parent = join(process.cwd(), 'test-results/protocol-container-proof')
  mkdirSync(parent, { recursive: true, mode: 0o700 })
  const root = mkdtempSync(join(parent, 'hronaut-contained-proof-'))
  mkdirSync(join(root, 'diagnostic-temp'))
  const ready = join(root, 'ready.json')
  const heartbeat = join(root, 'heartbeat')
  const grandchild = `const fs=require('fs');const stat=fs.readFileSync('/proc/self/stat','utf8').split(') ')[1].split(' ');fs.writeFileSync(${JSON.stringify(ready)},JSON.stringify({pid:process.pid,ppid:process.ppid,pgrp:Number(stat[2])})); console.log('SYNTHETIC_PRIVATE_SENTINEL'); console.error('SYNTHETIC_PRIVATE_SENTINEL');let n=0;setInterval(()=>fs.writeFileSync(${JSON.stringify(heartbeat)},String(++n)),20)`
  writeFileSync(join(root, 'fixture.cjs'), `require('child_process').spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{detached:true,stdio:'inherit'});setInterval(()=>{},1000)`)
  let container = ''
  const controller = new AbortController()
  const pending = isolatedContainer(root, image, ['node', join(root, 'fixture.cjs')], controller.signal, {
    ...dockerEngine, async create(args) { container = await dockerEngine.create(args); return container }
  })
  let completed = false
  try {
    await until(() => existsSync(ready))
    const status = JSON.parse(readFileSync(ready, 'utf8'))
    assert.ok(status.pid > 1 && status.ppid > 1)
    assert.equal(status.pgrp, status.pid)
    await until(() => existsSync(heartbeat) && Number(readFileSync(heartbeat, 'utf8')) >= 2)
    const top = execFileSync('docker', ['top', container, '-eo', 'pid,pgid'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const rows = top.trim().split('\n').slice(1).map(line => line.trim().split(/\s+/).map(Number))
    assert.ok(rows.length >= 3)
    assert.ok(rows.some(([pid, group]) => pid === group))
    controller.abort()
    const result = await pending; completed = true
    assert.deepEqual(result, { exitCode: null, killed: 1, stopped: 1 })
    assert.equal(await dockerEngine.absent(container), true)
    const lastHeartbeat = readFileSync(heartbeat, 'utf8')
    await new Promise(resolve => setTimeout(resolve, 250))
    assert.equal(readFileSync(heartbeat, 'utf8'), lastHeartbeat)
    // dockerEngine.remove verified Running=false, Pid=0 before removal. Private
    // PID namespace termination includes the detached group; heartbeat stopped.
    rmSync(root, { recursive: true, force: true })
    assert.equal(existsSync(root), false)
  } finally {
    controller.abort()
    if (!completed) await pending
    if (container && !(await dockerEngine.absent(container))) await dockerEngine.remove(container)
    rmSync(root, { recursive: true, force: true })
  }
})


test('same-user collector writes 0600 snapshots under 0700 nested directories readable and removable by host', async () => {
  const parent = join(process.cwd(), 'test-results/protocol-container-proof')
  mkdirSync(parent, { recursive: true, mode: 0o700 })
  const root = mkdtempSync(join(parent, 'hronaut-private-mode-proof-'))
  mkdirSync(join(root, 'diagnostic-temp'), { mode: 0o700 })
  const helpers = join(root, 'scripts/diagnostics')
  mkdirSync(helpers, { recursive: true, mode: 0o700 })
  for (const name of ['protocol-capture-worker.ts', 'protocol-capture-loader.ts', 'protocol-timing-overlay.ts', 'protocol-timing-runtime.ts'])
    copyFileSync(join(process.cwd(), 'scripts/diagnostics', name), join(helpers, name))
  writeFileSync(join(root, 'package.json'), '{"type":"module"}', { mode: 0o600 })
  const nested = join(root, 'private/nested')
  const snapshotPath = join(nested, 'snapshot.json')
  const identityPath = join(nested, 'identity.json')
  const script = `import {cpSync,mkdirSync,writeFileSync} from 'node:fs';
mkdirSync(${JSON.stringify(join(root, 'node_modules'))},{mode:0o700});
cpSync('/workspace/node_modules/typescript',${JSON.stringify(join(root, 'node_modules/typescript'))},{recursive:true});
const {captureBeforeCleanup}=await import(${JSON.stringify(join(helpers, 'protocol-capture-worker.ts'))});
mkdirSync(${JSON.stringify(nested)},{recursive:true,mode:0o700});
captureBeforeCleanup(()=>({capacity:2048,total:1,dropped:0,transports:1,rejectedTransports:0,observerErrors:0,rows:[[1,1,1,1,0,1,1]]}),data=>writeFileSync(${JSON.stringify(snapshotPath)},data,{flag:'wx',mode:0o600}));
writeFileSync(${JSON.stringify(identityPath)},JSON.stringify({uid:process.getuid(),gid:process.getgid()}),{flag:'wx',mode:0o600});`
  writeFileSync(join(root, 'fixture.mjs'), script, { mode: 0o600 })
  let stopped = false
  try {
    const result = await isolatedContainer(root, image, ['node', join(root, 'fixture.mjs')])
    stopped = result.stopped === 1
    assert.deepEqual(result, { exitCode: 0, killed: 0, stopped: 1 })
    const identity = JSON.parse(readFileSync(identityPath, 'utf8'))
    assert.deepEqual(identity, { uid: process.getuid!(), gid: process.getgid!() })
    for (const [path, mode] of [[snapshotPath, 0o600], [join(root, 'private'), 0o700], [nested, 0o700]] as const) {
      const stat = statSync(path)
      assert.equal(stat.mode & 0o777, mode)
      assert.equal(stat.uid, process.getuid!()); assert.equal(stat.gid, process.getgid!())
    }
    assert.equal(JSON.parse(readFileSync(snapshotPath, 'utf8')).status, 1)
    rmSync(root, { recursive: true, force: true })
    assert.equal(existsSync(root), false)
  } finally {
    // Never claim rollback or remove the bind tree if namespace stop is unknown.
    if (stopped) rmSync(root, { recursive: true, force: true })
  }
})

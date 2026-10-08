// Explicit host-only synthetic proof. Not part of browser capture or default CI.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
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

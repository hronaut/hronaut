import { EventEmitter } from 'node:events'
import type { IpcMainInvokeEvent } from 'electron'
import { expect, it, vi } from 'vitest'
import { WorkspaceStartupReads } from '../src/main/workspace-startup-reads.js'

function fixture() {
  let release!: () => void
  let fail!: (error: Error) => void
  const initialization = new Promise<void>((resolve, reject) => { release = resolve; fail = reject })
  const frame = { url: 'file:///shell.html', detached: false }
  const sender = Object.assign(new EventEmitter(), { mainFrame: frame, isDestroyed: () => false })
  const event = { sender, senderFrame: frame } as unknown as IpcMainInvokeEvent
  const authority = vi.fn()
  const ready = vi.fn()
  const read = vi.fn(() => 'snapshot')
  const barrier = new WorkspaceStartupReads()
  const run = () => barrier.run(event, initialization, authority, ready, read)
  return { release, fail, frame, sender, event, authority, ready, read, barrier, run }
}

it('holds concurrent reads without exposing snapshots and removes shared listeners after success', async () => {
  const f = fixture()
  const reads = Array.from({ length: 12 }, f.run)
  expect(f.read).not.toHaveBeenCalled()
  expect(f.sender.listenerCount('destroyed')).toBe(1)
  f.release()
  expect(await Promise.all(reads)).toEqual(Array(12).fill('snapshot'))
  expect(f.authority).toHaveBeenCalledTimes(36)
  expect(f.ready).toHaveBeenCalledTimes(24)
  expect(f.sender.eventNames()).toEqual([])
})

it.each(['destroyed', 'render-process-gone', 'did-start-navigation', 'did-navigate'])('cancels %s before initialization finishes, including same-URL replacement', async event => {
  const f = fixture()
  const result = f.run().catch(error => error)
  f.sender.emit(event, { isMainFrame: true, url: f.frame.url })
  expect(await result).toBeInstanceOf(Error)
  expect(f.sender.eventNames()).toEqual([])
  f.release()
  await Promise.resolve()
  expect(f.read).not.toHaveBeenCalled()
})

it('invalidates an asynchronous result and retains bounded capacity until abandoned work settles', async () => {
  const f = fixture()
  let complete!: (value: string) => void
  const work = new Promise<string>(resolve => { complete = resolve })
  const reads = Array.from({ length: 64 }, () => f.barrier.run(f.event, null, f.authority, f.ready, () => work).catch(error => error))
  f.sender.emit('did-navigate')
  expect((await Promise.all(reads)).every(value => value instanceof Error)).toBe(true)
  expect(f.sender.eventNames()).toEqual([])
  expect(f.run).toThrow('Too many pending workspace reads')
  complete('obsolete bytes')
  await Promise.resolve()
  expect(await f.barrier.run(f.event, null, f.authority, f.ready, f.read)).toBe('snapshot')
})

it('rechecks authority after an asynchronous read finishes', async () => {
  const f = fixture()
  let complete!: (value: string) => void
  const work = new Promise<string>(resolve => { complete = resolve })
  const result = f.barrier.run(f.event, null, f.authority, f.ready, () => work).catch(error => error)
  f.authority.mockImplementation(() => { throw new Error('Replaced owner') })
  complete('obsolete bytes')
  expect(await result).toMatchObject({ message: 'Replaced owner' })
  expect(f.sender.eventNames()).toEqual([])
})

it('rolls back partial listener installation', () => {
  const f = fixture()
  const on = f.sender.on.bind(f.sender)
  vi.spyOn(f.sender, 'on').mockImplementation((event, listener) => {
    if (event === 'did-start-navigation') throw new Error('Unavailable sender')
    return on(event, listener)
  })
  expect(f.run).toThrow('Unavailable sender')
  expect(f.sender.eventNames()).toEqual([])
  expect(f.read).not.toHaveBeenCalled()
  f.release()
})

it.each(['authority', 'ready'] as const)('rechecks %s after waiting and never calls the read on failure', async boundary => {
  const f = fixture()
  const result = f.run().catch(error => error)
  f[boundary].mockImplementation(() => { throw new Error('Rejected') })
  f.release()
  expect(await result).toMatchObject({ message: 'Rejected' })
  expect(f.read).not.toHaveBeenCalled()
  expect(f.sender.eventNames()).toEqual([])
})

it('fails closed if initialization rejects, without exposing its error', async () => {
  const f = fixture()
  const result = f.run().catch(error => error)
  f.fail(new Error('private internal failure'))
  expect(await result).toMatchObject({ message: 'Workspace read is no longer available.' })
  expect(f.read).not.toHaveBeenCalled()
})

it('bounds pending reads and releases capacity when the originating document goes away', async () => {
  const f = fixture()
  const reads = Array.from({ length: 64 }, () => f.run().catch(error => error))
  expect(f.run).toThrow('Too many pending workspace reads')
  f.sender.emit('did-start-navigation', { isMainFrame: true })
  expect((await Promise.all(reads)).every(value => value instanceof Error)).toBe(true)
  const current = f.run()
  f.release()
  expect(await current).toBe('snapshot')
  expect(f.read).toHaveBeenCalledTimes(1)
})

it('does not queue an untrusted caller or accept a detached or replaced frame', async () => {
  const f = fixture()
  f.authority.mockImplementationOnce(() => { throw new Error('Untrusted') })
  expect(f.run).toThrow('Untrusted')
  expect(f.sender.eventNames()).toEqual([])
  const result = f.run().catch(error => error)
  f.sender.mainFrame = { ...f.frame }
  f.release()
  expect(await result).toBeInstanceOf(Error)
  expect(f.read).not.toHaveBeenCalled()
})

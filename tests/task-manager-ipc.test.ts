import { describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { registerTaskManagerIpc } from '../src/main/task-manager-ipc.js'

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

function register() {
  const handlers = new Map<string, Handler>()
  const assertMainSender = vi.fn((event: IpcMainInvokeEvent) => {
    if ((event as unknown as { trusted?: boolean }).trusted !== true) throw new Error('Rejected IPC from a non-primary renderer')
  })
  const tabs = { taskManagerProcesses: vi.fn(() => [{ pid: 10 }]), endTaskManagerProcess: vi.fn() }
  registerTaskManagerIpc({
    assertMainSender,
    handleBrowserIpc: (channel, listener) => { handlers.set(channel, listener as Handler) },
    tabs: () => tabs as never
  })
  const trusted = { trusted: true } as unknown as IpcMainInvokeEvent
  const untrusted = {} as IpcMainInvokeEvent
  return { handlers, tabs, trusted, untrusted }
}

describe('the Task manager\'s IPC', () => {
  it('lists the processes for the main window only', () => {
    const { handlers, tabs, trusted, untrusted } = register()
    expect([...handlers.keys()]).toEqual(['task-manager:list', 'task-manager:end-process'])
    expect(handlers.get('task-manager:list')!(trusted)).toEqual([{ pid: 10 }])
    expect(() => handlers.get('task-manager:list')!(untrusted)).toThrow('Rejected IPC')
    expect(tabs.taskManagerProcesses).toHaveBeenCalledOnce()
  })

  it('ends only a whole positive process ID, from the main window only', () => {
    const { handlers, tabs, trusted, untrusted } = register()
    const end = handlers.get('task-manager:end-process')!
    end(trusted, 4321)
    expect(tabs.endTaskManagerProcess).toHaveBeenCalledWith(4321)
    for (const pid of ['4321', 0, -5, 2.5, Number.NaN, null, undefined]) expect(() => end(trusted, pid), String(pid)).toThrow('Invalid process ID')
    expect(() => end(untrusted, 4321)).toThrow('Rejected IPC')
    expect(tabs.endTaskManagerProcess).toHaveBeenCalledOnce()
  })
})

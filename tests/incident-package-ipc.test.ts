import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { expect, it, vi } from 'vitest'
import { registerIncidentPackageIpc } from '../src/main/incident-package-ipc.js'
import type { IncidentDraft, IncidentPreview } from '../src/shared/incident-package.js'

function fixture() {
  const handlers = new Map<string, Parameters<IpcMain['handle']>[1]>()
  const event = { sender: { id: 1, once: vi.fn() } } as unknown as IpcMainInvokeEvent
  const host = {
    assertTrustedSender: vi.fn(), version: 'test',
    tabs: vi.fn(() => ({ getState: () => ({ tabs: [{ id: 'tab', navigationGeneration: 1 }] }),
      reproRecording: vi.fn(async () => ({ active: false, steps: [], caveats: [], truncated: false })) }) as never),
    pickDestination: vi.fn<() => Promise<string | undefined>>(async () => '/tmp/reviewed.html'),
    write: vi.fn(async (_path: string, _text: string, _mode?: number, beforeCommit?: () => void) => { beforeCommit?.() })
  }
  registerIncidentPackageIpc({ handle: (name, fn) => { handlers.set(name, fn) } }, host)
  const call = (name: string, value?: unknown) => Promise.resolve().then(() => handlers.get(`browser:incident-${name}`)!(event, value))
  async function reviewed() {
    const draft = await call('capture', { tabId: 'tab', minutes: 1, kinds: ['repro'] }) as IncidentDraft
    const preview = await call('review', { draftId: draft.draftId, include: ['repro'], replacements: [] }) as IncidentPreview
    return { draft, preview, input: { draftId: draft.draftId, previewId: preview.previewId, reviewed: true } }
  }
  return { host, call, reviewed }
}
it.each(['capture', 'review', 'save', 'discard', 'invalidate-preview'])('rejects untrusted %s before resolving services or dialogs', async action => {
  const { host, call } = fixture()
  host.assertTrustedSender.mockImplementation(() => { throw new Error('Untrusted') })
  await expect(call(action)).rejects.toThrow('Untrusted')
  expect(host.tabs).not.toHaveBeenCalled()
  expect(host.pickDestination).not.toHaveBeenCalled()
})
it('writes only the exact reviewed preview after explicit acknowledgement', async () => {
  const { host, call, reviewed } = fixture()
  const { preview, input } = await reviewed()
  await expect(call('save', { ...input, reviewed: false })).rejects.toThrow()
  expect(host.pickDestination).not.toHaveBeenCalled()
  await expect(call('save', input)).resolves.toEqual({ saved: true, sha256: preview.sha256, bytes: preview.bytes })
  expect(host.write).toHaveBeenCalledWith('/tmp/reviewed.html', preview.html, 0o600, expect.any(Function))
})
it('does not write when the native dialog is cancelled', async () => {
  const { host, call, reviewed } = fixture()
  const { input } = await reviewed()
  host.pickDestination.mockResolvedValueOnce(undefined)
  await expect(call('save', input)).resolves.toEqual({ saved: false })
  expect(host.write).not.toHaveBeenCalled()
})
it.each(['discard', 'untrusted'])('rechecks %s after the asynchronous native dialog', async action => {
  const { host, call, reviewed } = fixture()
  const { input } = await reviewed()
  host.pickDestination.mockImplementationOnce(async () => {
    if (action === 'discard') await call('discard')
    else host.assertTrustedSender.mockImplementation(() => { throw new Error('Untrusted') })
    return '/tmp/reviewed.html'
  })
  await expect(call('save', input)).rejects.toThrow()
  expect(host.write).not.toHaveBeenCalled()
})

it('rejects the file commit if review is discarded while writing the temporary file', async () => {
  const { host, call, reviewed } = fixture()
  const { input } = await reviewed()
  host.write.mockImplementationOnce(async (_path, _text, _mode, beforeCommit) => {
    await call('discard')
    beforeCommit?.()
  })
  await expect(call('save', input)).rejects.toThrow('missing')
})

it.each(['edit', 'invalid-review'])('rejects saving old bytes after %s during the native dialog', async action => {
  const { host, call, reviewed } = fixture()
  const { draft, input } = await reviewed()
  host.pickDestination.mockImplementationOnce(async () => {
    if (action === 'edit') await call('invalidate-preview', draft.draftId)
    else await expect(call('review', { 'private-invalid-key': true })).rejects.toThrow('Invalid incident review')
    return '/tmp/stale.html'
  })
  await expect(call('save', input)).rejects.toThrow('changed')
  expect(host.write).not.toHaveBeenCalled()
})

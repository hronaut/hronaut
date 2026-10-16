import { describe, expect, it } from 'vitest'
import { HumanWaitingService } from '../src/main/mcp/human-waiting-service.js'
import { HUMAN_WAITING_NOTE_LIMIT, normalizeHumanWaitingNote } from '../src/shared/human-waiting.js'

const input = {
  workspaceId: '0198dc5b-4192-7000-8000-000000000001', runId: '0198dc5b-4192-7000-8000-000000000002',
  decision: 'provide-input' as const, owner: 'local-operator', fallbackOwner: 'local-operator',
  timeoutMs: 60_000, priorOutcome: 'NONE' as const
}
const authorize = () => undefined
const fresh = async () => undefined

function service() {
  const saved: string[] = []
  return { saved, service: new HumanWaitingService({ load: async () => null, save: async (snapshot) => { saved.push(JSON.stringify(snapshot)) } }) }
}

describe('a person\'s answer to an agent\'s decision', () => {
  it('cleans a note: line breaks kept, other control characters and surrounding space dropped, bounded', () => {
    expect(normalizeHumanWaitingNote('  Use the\r\nstaging\u0007 card \u009b ')).toBe('Use the\nstaging card')
    expect(normalizeHumanWaitingNote(' \t ')).toBeUndefined()
    expect(normalizeHumanWaitingNote(undefined)).toBeUndefined()
    expect(normalizeHumanWaitingNote(42)).toBeNull()
    expect(normalizeHumanWaitingNote('x'.repeat(HUMAN_WAITING_NOTE_LIMIT))).toHaveLength(HUMAN_WAITING_NOTE_LIMIT)
    expect(normalizeHumanWaitingNote('x'.repeat(HUMAN_WAITING_NOTE_LIMIT + 1))).toBeNull()
  })

  it('gives the agent the note and when it was answered, and never saves the note', async () => {
    const { service: waiting, saved } = service()
    const record = await waiting.create(input, authorize)
    const before = Date.now()
    const resolved = await waiting.change(input.workspaceId, record.id, record.revision, 'resolve', authorize, fresh, undefined, { note: 'Use promo code SPRING' })
    expect(resolved).toMatchObject({ state: 'RESOLVED', note: 'Use promo code SPRING' })
    expect(resolved.answeredAt).toBeGreaterThanOrEqual(before)
    expect((await waiting.list(input.workspaceId, authorize))[0]).toMatchObject({ state: 'RESOLVED', note: 'Use promo code SPRING', answeredAt: resolved.answeredAt })
    expect(saved.length).toBeGreaterThan(0)
    for (const snapshot of saved) {
      expect(snapshot).not.toContain('SPRING')
      expect(snapshot).not.toContain('answeredAt')
    }
  })

  it('sends a rejection\'s note too, and marks a cancellation by the person without one', async () => {
    const { service: waiting } = service()
    const first = await waiting.create(input, authorize)
    await expect(waiting.change(input.workspaceId, first.id, first.revision, 'reject', authorize, undefined, undefined, { note: 'The total is wrong' }))
      .resolves.toMatchObject({ state: 'REJECTED', note: 'The total is wrong' })
    const second = await waiting.create({ ...input, runId: '0198dc5b-4192-7000-8000-000000000003' }, authorize)
    const cancelled = await waiting.change(input.workspaceId, second.id, second.revision, 'cancel', authorize, undefined, undefined, {})
    expect(cancelled.state).toBe('CANCELLED')
    expect(cancelled.answeredAt).toEqual(expect.any(Number))
    expect(cancelled).not.toHaveProperty('note')
  })

  it('does not say the person answered when the agent cancels its own request', async () => {
    const { service: waiting } = service()
    const record = await waiting.create(input, authorize)
    const cancelled = await waiting.change(input.workspaceId, record.id, record.revision, 'cancel', authorize)
    expect(cancelled).not.toHaveProperty('answeredAt')
  })

  it('refuses a note with an acknowledgment or cancellation, or one it has not cleaned', async () => {
    const { service: waiting } = service()
    const record = await waiting.create(input, authorize)
    await expect(waiting.change(input.workspaceId, record.id, record.revision, 'acknowledge', authorize, undefined, undefined, { note: 'seen' })).rejects.toThrow(/note/)
    await expect(waiting.change(input.workspaceId, record.id, record.revision, 'cancel', authorize, undefined, undefined, { note: 'never mind' })).rejects.toThrow(/note/)
    await expect(waiting.change(input.workspaceId, record.id, record.revision, 'resolve', authorize, fresh, undefined, { note: ' padded ' })).rejects.toThrow(/note/)
    await expect(waiting.change(input.workspaceId, record.id, record.revision, 'resolve', authorize, fresh, undefined, { note: 'x'.repeat(HUMAN_WAITING_NOTE_LIMIT + 1) })).rejects.toThrow(/note/)
    expect((await waiting.list(input.workspaceId, authorize))[0]).toMatchObject({ state: 'WAITING_FOR_HUMAN' })
  })

  it('forgets the answer when the page changed while the resolution was saved', async () => {
    let saves = 0
    let changed = false
    const waiting = new HumanWaitingService({ load: async () => null, save: async () => { if (++saves === 2) changed = true } })
    const record = await waiting.create(input, authorize)
    await expect(waiting.change(input.workspaceId, record.id, record.revision, 'resolve', authorize, async () => {
      if (changed) throw new Error('browser changed')
    }, undefined, { note: 'Use promo code SPRING' })).rejects.toThrow(/review/i)
    const [current] = await waiting.list(input.workspaceId, authorize)
    expect(current).toMatchObject({ state: 'WAITING_FOR_HUMAN' })
    expect(current).not.toHaveProperty('note')
    expect(current).not.toHaveProperty('answeredAt')
  })
})

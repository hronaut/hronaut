import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { HumanWaitingPersistence } from '../src/main/mcp/human-waiting-persistence.js'
import { HumanWaitingService } from '../src/main/mcp/human-waiting-service.js'
import { HumanWaitingStore } from '../src/main/mcp/human-waiting-store.js'

const WORKSPACE_ID = '0198dc5b-4192-7000-8000-000000000001'
const authorize = (): void => undefined
let directory: string | undefined

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
  directory = undefined
})

/** A valid four-step review whose step texts use the full 512 characters in a non-Latin script. */
function largeGroupedReview(text: string) {
  const step = (index: number) => ({
    toolName: 'browser_click', actionClass: 'interact' as const, reversibility: 'unknown' as const,
    representation: 'bounded-description' as const, description: text, expectedPostcondition: text,
    artifactHash: String(index).repeat(64), origin: 'https://shop.example',
    tabId: '0198dc5b-4192-7000-8000-0000000000aa', navigationGeneration: 3, humanInputGeneration: 0,
    browserSessionGeneration: 0
  })
  const steps = [step(1), step(2), step(3), step(4)]
  return { ...steps[0]!, sessionBinding: 'b'.repeat(64), workspaceName: 'Checkout', profileName: 'Full access', steps, currentStep: 0 }
}

describe('human waiting history size', () => {
  // Regression: the store kept up to 100 finished decisions however large they were, while the persistence owner
  // refuses a history over 1 MiB. About 80 finished four-step reviews written in Cyrillic (58 in CJK) crossed that limit:
  // the next save failed, the service marked the history unavailable, and every later workspace tool call failed its
  // human-waiting dispatch check until Hronaut restarted.
  it('keeps admitting agent dispatch after many large finished reviews', async () => {
    directory = await mkdtemp(join(tmpdir(), 'hronaut-waiting-size-'))
    const path = join(directory, 'human-waiting.json')
    const service = new HumanWaitingService(new HumanWaitingPersistence(path), new HumanWaitingStore())
    const request = {
      workspaceId: WORKSPACE_ID, runId: '0198dc5b-4192-7000-8000-000000000002', decision: 'approve-action' as const,
      owner: 'local-operator', fallbackOwner: 'local-operator', timeoutMs: 60_000,
      priorOutcome: 'OUTCOME_UNKNOWN' as const, review: largeGroupedReview('ж'.repeat(512))
    }
    for (let attempt = 1; attempt <= 100; attempt += 1) {
      const record = await service.create(request, authorize)
      await service.change(WORKSPACE_ID, record.id, record.revision, 'cancel', authorize)
    }
    await expect(service.requireDispatch(WORKSPACE_ID, authorize)).resolves.toBeUndefined()
    expect((await stat(path)).size).toBeLessThanOrEqual(1_048_576)
    const restored = new HumanWaitingStore()
    restored.restore(await new HumanWaitingPersistence(path).load())
    expect(restored.list(WORKSPACE_ID).length).toBeGreaterThan(0)
  }, 60_000)

  it('refuses a decision that cannot fit beside open reviews without disabling the history', async () => {
    directory = await mkdtemp(join(tmpdir(), 'hronaut-waiting-size-'))
    const path = join(directory, 'human-waiting.json')
    const service = new HumanWaitingService(new HumanWaitingPersistence(path), new HumanWaitingStore())
    const workspaceId = (index: number): string => `0198dc5b-4192-7000-8000-${String(index).padStart(12, '0')}`
    let refused: unknown
    for (let index = 1; index <= 100 && !refused; index += 1) {
      await service.create({
        workspaceId: workspaceId(index), runId: '0198dc5b-4192-7000-8000-000000000002', decision: 'approve-action',
        owner: 'local-operator', fallbackOwner: 'local-operator', timeoutMs: 60_000, priorOutcome: 'OUTCOME_UNKNOWN',
        review: largeGroupedReview('ж'.repeat(512))
      }, authorize).catch((error: unknown) => { refused = error })
    }
    expect(refused).toBeInstanceOf(Error)
    expect((refused as Error).message).toMatch(/capacity/i)
    await expect(service.list(workspaceId(1), authorize)).resolves.toHaveLength(1)
    expect((await stat(path)).size).toBeLessThanOrEqual(1_048_576)
  }, 60_000)
})

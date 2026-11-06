import { shallowRef } from 'vue'
import { describe, expect, it } from 'vitest'
import { usePermissionReloadOffer } from '../../src/renderer/src/features/site-controls/usePermissionReloadOffer.js'

// Blocking a site's camera or location in Site controls left a page already using it going on, with nothing saying that
// it applies only once the page loads again. Chrome's site information then offers to reload the page.
describe('the offer to reload a page after a permission changed in Site controls', () => {
  function setup() {
    const active = shallowRef<{ id: string; documentGeneration?: number } | undefined>({ id: 'tab-1', documentGeneration: 3 })
    const offer = usePermissionReloadOffer(() => active.value)
    return { active, offer }
  }

  it('stands once a permission changed, for as long as the tab shows that document', async () => {
    const { active, offer } = setup()
    expect(offer.offered.value).toBe(false)
    await expect(offer.change('geolocation', () => true)).resolves.toBe(true)
    expect(offer.offered.value).toBe(true)

    // Another tab shown, then the tab again: the page has not loaded since.
    active.value = { id: 'tab-2', documentGeneration: 3 }
    expect(offer.offered.value).toBe(false)
    active.value = { id: 'tab-1', documentGeneration: 3 }
    expect(offer.offered.value).toBe(true)

    // The page loaded again, so its new document has the new settings.
    active.value = { id: 'tab-1', documentGeneration: 4 }
    expect(offer.offered.value).toBe(false)
  })

  it('gives the tab to reload, once', async () => {
    const { active, offer } = setup()
    await offer.change('media', () => Promise.resolve(true))
    expect(offer.accept()).toBe('tab-1')
    expect(offer.offered.value).toBe(false)
    expect(offer.accept()).toBeUndefined()

    // Nothing to reload once another page shows.
    await offer.change('media', () => true)
    active.value = { id: 'tab-1', documentGeneration: 5 }
    expect(offer.accept()).toBeUndefined()
  })

  it('is not made for a change that failed, for the site\'s sound, or once another page shows', async () => {
    const { active, offer } = setup()
    await expect(offer.change('geolocation', () => false)).resolves.toBe(false)
    expect(offer.offered.value).toBe(false)

    // Muting a site applies at once.
    await offer.change('sound', () => true)
    expect(offer.offered.value).toBe(false)

    // The page went on to another while the change was saved.
    await offer.change('geolocation', () => {
      active.value = { id: 'tab-1', documentGeneration: 4 }
      return true
    })
    expect(offer.offered.value).toBe(false)

    // A change still being saved as the page goes on does not take the offer from a change made on the new page.
    let finishFirst!: (changed: boolean) => void
    const first = offer.change('geolocation', () => new Promise<boolean>((resolve) => { finishFirst = resolve }))
    active.value = { id: 'tab-1', documentGeneration: 5 }
    await offer.change('media', () => true)
    expect(offer.offered.value).toBe(true)
    finishFirst(true)
    await first
    expect(offer.offered.value).toBe(true)

    // Nor with no tab shown.
    active.value = undefined
    await offer.change('geolocation', () => true)
    expect(offer.offered.value).toBe(false)
  })
})

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installHronautWalletProviders } from '../src/preload/wallet-provider-bootstrap.js'

type DiscoveryWindow = Window & typeof globalThis & {
  __hronautWalletBridge?: {
    request: ReturnType<typeof vi.fn>
    subscribe: ReturnType<typeof vi.fn>
    unsubscribe: ReturnType<typeof vi.fn>
  }
  ethereum?: unknown
  hronautEthereum?: unknown
  solana?: unknown
  hronautSolana?: unknown
  tron?: unknown
  hronautTron?: unknown
}

interface AnnouncementDetail {
  info: { uuid: string; name: string; icon: string; rdns: string }
  provider: unknown
}

const frames: HTMLIFrameElement[] = []

function freshPage(options: { bridge?: boolean } = { bridge: true }) {
  const frame = document.createElement('iframe')
  document.body.append(frame)
  frames.push(frame)
  const page = frame.contentWindow as DiscoveryWindow
  const request = vi.fn(async (input: unknown) => ({ input }))
  const subscribe = vi.fn()
  const unsubscribe = vi.fn()
  if (options.bridge !== false) page.__hronautWalletBridge = { request, subscribe, unsubscribe }

  const install = (): void => {
    page.eval(`(${installHronautWalletProviders.toString()})()`)
  }
  return { page, request, subscribe, unsubscribe, install }
}

function collect(page: Window, eventName: string): AnnouncementDetail[] {
  const announcements: AnnouncementDetail[] = []
  page.addEventListener(eventName, (event) => {
    announcements.push((event as CustomEvent<AnnouncementDetail>).detail)
  })
  return announcements
}

afterEach(() => {
  for (const frame of frames.splice(0)) frame.remove()
})

describe('wallet provider discovery lifecycle', () => {
  it('reannounces stable EVM provider metadata to early and late listeners without bridge operations', () => {
    const { page, request, install } = freshPage()
    const early = collect(page, 'eip6963:announceProvider')

    install()
    expect(early).toHaveLength(1)

    const late = collect(page, 'eip6963:announceProvider')
    page.dispatchEvent(new page.Event('eip6963:requestProvider'))
    page.dispatchEvent(new page.Event('eip6963:requestProvider'))

    expect(early).toHaveLength(3)
    expect(late).toHaveLength(2)
    expect(early.map(({ provider }) => provider)).toEqual([page.hronautEthereum, page.hronautEthereum, page.hronautEthereum])
    expect(new Set(early.map(({ info }) => info.uuid))).toEqual(new Set([early[0]?.info.uuid]))
    for (const detail of early) {
      expect(detail.info).toMatchObject({ name: 'Hronaut', rdns: 'dev.hronaut.wallet' })
      expect(Object.isFrozen(detail)).toBe(true)
      expect(Object.isFrozen(detail.info)).toBe(true)
    }
    expect(request).not.toHaveBeenCalled()
  })

  it('reannounces stable TRON provider metadata to early and late listeners without crossing EVM discovery', () => {
    const { page, request, install } = freshPage()
    const tronEarly = collect(page, 'TIP6963:announceProvider')
    const evm = collect(page, 'eip6963:announceProvider')

    install()
    expect(tronEarly).toHaveLength(1)
    expect(evm).toHaveLength(1)

    const tronLate = collect(page, 'TIP6963:announceProvider')
    page.dispatchEvent(new page.Event('TIP6963:requestProvider'))
    page.dispatchEvent(new page.Event('TIP6963:requestProvider'))

    expect(tronEarly).toHaveLength(3)
    expect(tronLate).toHaveLength(2)
    expect(evm).toHaveLength(1)
    expect(tronEarly.map(({ provider }) => provider)).toEqual([page.hronautTron, page.hronautTron, page.hronautTron])
    expect(new Set(tronEarly.map(({ info }) => info.uuid))).toEqual(new Set([tronEarly[0]?.info.uuid]))
    for (const detail of tronEarly) {
      expect(detail.info).toMatchObject({ name: 'Hronaut', rdns: 'dev.hronaut.wallet' })
      expect(Object.isFrozen(detail)).toBe(true)
      expect(Object.isFrozen(detail.info)).toBe(true)
    }
    expect(request).not.toHaveBeenCalled()
  })

  it('keeps EVM and TRON request channels independent', () => {
    const { page, install } = freshPage()
    const evm = collect(page, 'eip6963:announceProvider')
    const tron = collect(page, 'TIP6963:announceProvider')
    install()

    page.dispatchEvent(new page.Event('eip6963:requestProvider'))
    expect(evm).toHaveLength(2)
    expect(tron).toHaveLength(1)

    page.dispatchEvent(new page.Event('TIP6963:requestProvider'))
    expect(evm).toHaveLength(2)
    expect(tron).toHaveLength(2)
  })

  it('preserves existing wallet globals and exposes Hronaut providers under its own names', () => {
    const { page, install } = freshPage()
    const existingEthereum = Object.freeze({ name: 'existing EVM provider' })
    const existingSolana = Object.freeze({ name: 'existing Solana provider' })
    const existingTron = Object.freeze({ name: 'existing TRON provider' })
    page.ethereum = existingEthereum
    page.solana = existingSolana
    page.tron = existingTron

    install()

    expect(page.ethereum).toBe(existingEthereum)
    expect(page.solana).toBe(existingSolana)
    expect(page.tron).toBe(existingTron)
    expect(page.hronautEthereum).toBeDefined()
    expect(page.hronautSolana).toBeDefined()
    expect(page.hronautTron).toBeDefined()
  })

  it('installs once per page and does nothing when the wallet bridge is absent', () => {
    const bridged = freshPage()
    const evm = collect(bridged.page, 'eip6963:announceProvider')
    const tron = collect(bridged.page, 'TIP6963:announceProvider')

    bridged.install()
    expect(bridged.subscribe).toHaveBeenCalledTimes(3)
    bridged.install()
    expect(bridged.subscribe).toHaveBeenCalledTimes(3)
    expect(evm).toHaveLength(1)
    expect(tron).toHaveLength(1)

    const absent = freshPage({ bridge: false })
    absent.install()
    expect(absent.page.hronautEthereum).toBeUndefined()
    expect(absent.page.hronautSolana).toBeUndefined()
    expect(absent.page.hronautTron).toBeUndefined()
  })
})

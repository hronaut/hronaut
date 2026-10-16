// @vitest-environment jsdom
import { ref } from 'vue'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import WalletApprovalDialog from '../../src/renderer/src/components/WalletApprovalDialog.vue'
import type { WalletsController } from '../../src/renderer/src/composables/useWalletsController.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { WalletRequestSummary } from '../../src/shared/wallet.js'

function request(id = 'request-1', walletName = 'Main wallet'): WalletRequestSummary {
  return {
    id, walletId: 'wallet-1', workspaceId: 'workspace-1', status: 'awaiting-human',
    approvalHash: 'a'.repeat(64), operation: 'sign-message',
    requester: { type: 'website', id: 'tab-1', name: 'Dapp' }, origin: 'https://dapp.example',
    networkId: '1', createdAt: '2026-08-28T12:00:00.000Z', expiresAt: '2026-08-28T12:05:00.000Z',
    details: {
      walletName, publicAddress: '0x0000000000000000000000000000000000000001',
      chainFamily: 'evm', networkName: 'Ethereum', capability: 'sign', understood: true,
      simulationAttempted: false, simulationSuccess: false, method: 'personal_sign',
      source: '0x0000000000000000000000000000000000000002',
      raw: { messageCanonicalBase64: 'c2lnbiB0aGlzIGV4YWN0IG1lc3NhZ2U=', messageUtf8Preview: 'sign this exact message' }
    }
  }
}

function controller(): WalletsController {
  const pending = request()
  return {
    awaitingApproval: ref([pending]), busy: ref(false), errorMessage: ref(''),
    approve: vi.fn(async () => undefined), reject: vi.fn(async () => undefined)
  } as unknown as WalletsController
}

describe('WalletApprovalDialog', () => {
  it('shows exact trusted message content and only acts from explicit chrome buttons', async () => {
    const wallets = controller()
    const view = render(WalletApprovalDialog, {
      props: {
        controller: wallets,
        workspaces: [{ id: 'workspace-1', name: 'Primary workspace' }]
      },
      global: { plugins: [createHronautI18n('en-US')] }
    })
    const dialog = screen.getByRole('alertdialog', { name: /sign message/i })

    expect(dialog).toHaveTextContent('sign this exact message')
    expect(dialog).toHaveTextContent('c2lnbiB0aGlzIGV4YWN0IG1lc3NhZ2U=')
    expect(dialog).toHaveTextContent('Primary workspace')
    expect(dialog).toHaveTextContent('Source account')
    expect(dialog).toHaveTextContent('0x0000000000000000000000000000000000000002')
    await userEvent.setup().click(view.container.querySelector('.wallet-approval-overlay')!)
    expect(wallets.approve).not.toHaveBeenCalled()

    await userEvent.setup().click(screen.getByRole('button', { name: 'Approve exact request' }))
    expect(wallets.approve).toHaveBeenCalledOnce()
    expect(wallets.approve).toHaveBeenCalledWith('request-1')
  })

  it('takes and traps keyboard focus inside trusted approval chrome', async () => {
    const background = document.createElement('button')
    background.textContent = 'Website action'
    document.body.append(background)
    background.focus()
    const wallets = controller()
    render(WalletApprovalDialog, {
      props: { controller: wallets, workspaces: [] }, global: { plugins: [createHronautI18n('en-US')] }
    })

    const dialog = screen.getByRole('alertdialog', { name: /sign message/i })
    const reject = screen.getByRole('button', { name: 'Reject' })
    const approve = screen.getByRole('button', { name: 'Approve exact request' })
    const user = userEvent.setup()
    await vi.waitFor(() => expect(dialog).toHaveFocus())
    await user.tab({ shift: true })
    expect(approve).toHaveFocus()
    await user.tab()
    expect(screen.getByText('Raw unsigned request')).toHaveFocus()
    await user.tab()
    expect(reject).toHaveFocus()
    background.focus()
    expect(dialog.contains(document.activeElement)).toBe(true)
    background.remove()
  })

  it('shows message text outside the raw request, with each warning as an alert', () => {
    const pending = request()
    pending.details = {
      ...pending.details!,
      understood: true,
      message: { text: 'phishing.example wants you to sign in with your Ethereum account:\n0x01', warnings: ['sign-in-other-site', 'sign-in-other-chain'] }
    }
    render(WalletApprovalDialog, {
      props: { controller: { ...controller(), awaitingApproval: ref([pending]) } as unknown as WalletsController, workspaces: [] },
      global: { plugins: [createHronautI18n('en-US')] }
    })

    const text = screen.getByRole('region', { name: 'Message to sign' })
    expect(text.tagName).toBe('PRE')
    expect(text.closest('details')).toBeNull()
    expect(text.textContent).toBe('phishing.example wants you to sign in with your Ethereum account:\n0x01')
    expect(screen.getAllByRole('alert').map((alert) => alert.textContent)).toEqual([
      'This sign-in message names a different website than the one asking. Signing it could log someone in to that other site as you.',
      "This sign-in message names a different chain than this wallet's network."
    ])
    expect(screen.queryByText(/could not fully decode/)).toBeNull()
    expect(screen.queryByText(/first 4,096 characters/)).toBeNull()
  })

  it('says when the shown message text is cut short', () => {
    const pending = request()
    pending.details = { ...pending.details!, understood: false, message: { text: 'a'.repeat(4_096), truncated: true, warnings: [] } }
    render(WalletApprovalDialog, {
      props: { controller: { ...controller(), awaitingApproval: ref([pending]) } as unknown as WalletsController, workspaces: [] },
      global: { plugins: [createHronautI18n('en-US')] }
    })

    expect(screen.getByText(/Only the first 4,096 characters are shown here/)).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('could not fully decode')
  })

  it('summarizes a typed-data permit with its spender, tokens and warnings', () => {
    const pending = request()
    pending.details = {
      ...pending.details!,
      understood: false,
      typedData: {
        primaryType: 'PermitBatch',
        domain: { name: 'Permit2', version: '1', chainId: '1', verifyingContract: '0x000000000022D473030F116dDEE9F6B43aC78BA3' },
        tokenAccess: {
          kind: 'allowance',
          spender: '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD',
          allowances: [{ token: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', amount: '1461501637330902918203684832716283019655932542975', unlimited: true }, { token: '0x2000000000000000000000000000000000000002', amount: '42' }],
          moreAllowances: true
        },
        warnings: ['token-permit', 'unlimited-amount']
      }
    }
    render(WalletApprovalDialog, {
      props: { controller: { ...controller(), awaitingApproval: ref([pending]) } as unknown as WalletsController, workspaces: [] },
      global: { plugins: [createHronautI18n('en-US')] }
    })

    const section = screen.getByRole('region', { name: 'Typed data to sign' })
    expect(section).toHaveTextContent('PermitBatch')
    expect(section).toHaveTextContent('Permit2 · version 1')
    expect(section).toHaveTextContent('0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD')
    expect(section).toHaveTextContent('Token allowance 10x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238 · Unlimited')
    expect(section).toHaveTextContent('Token allowance 20x2000000000000000000000000000000000000002 · 42 (smallest token units)')
    expect(section).toHaveTextContent('More tokens are listed in the raw unsigned request.')
    expect(section).not.toHaveTextContent('Recipient')
    expect(screen.getAllByRole('alert').map((alert) => alert.textContent?.trim())).toEqual([
      'Hronaut could not fully decode this request. Approval requires extra care.',
      'This is a token permit. Signing it lets the spender move your tokens without another approval from you.',
      'This signature covers an unlimited amount of the token.'
    ])
  })

  it('shows until when a typed-data permit can be used, and warns when it never expires', () => {
    const expiresAt = '2027-01-15T08:00:00.000Z'
    const permit = (tokenAccess: Record<string, unknown>, warnings: string[]): WalletRequestSummary => {
      const pending = request()
      pending.details = {
        ...pending.details!,
        typedData: {
          primaryType: 'Permit', domain: { name: 'USD Coin', chainId: '1' },
          tokenAccess: { kind: 'allowance', allowances: [{ amount: '5' }], ...tokenAccess },
          warnings
        } as NonNullable<NonNullable<WalletRequestSummary['details']>['typedData']>
      }
      return pending
    }
    const view = render(WalletApprovalDialog, {
      props: { controller: { ...controller(), awaitingApproval: ref([permit({ expiresAt }, ['token-permit'])]) } as unknown as WalletsController, workspaces: [] },
      global: { plugins: [createHronautI18n('en-US')] }
    })
    expect(screen.getByRole('region', { name: 'Typed data to sign' })).toHaveTextContent(`Valid until${new Date(expiresAt).toLocaleString()}`)
    view.unmount()

    render(WalletApprovalDialog, {
      props: { controller: { ...controller(), awaitingApproval: ref([permit({ neverExpires: true }, ['token-permit', 'no-expiry'])]) } as unknown as WalletsController, workspaces: [] },
      global: { plugins: [createHronautI18n('en-US')] }
    })
    expect(screen.getByRole('region', { name: 'Typed data to sign' })).toHaveTextContent('Valid untilNever expires')
    expect(screen.getAllByRole('alert').map((alert) => alert.textContent?.trim()))
      .toContain('This signature never expires, so it can still be used long after you sign it.')
  })

  it('summarizes a typed-data token transfer with its recipient, amounts and an unreadable amount', () => {
    const pending = request()
    pending.details = {
      ...pending.details!,
      understood: false,
      typedData: {
        primaryType: 'TransferWithAuthorization',
        domain: { version: '2', chainId: '1', verifyingContract: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' },
        tokenAccess: { kind: 'transfer', recipient: '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD', allowances: [{ token: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', amount: '2500000' }, { token: '0x2000000000000000000000000000000000000002' }] },
        warnings: ['token-transfer', 'unreadable-amount']
      }
    }
    render(WalletApprovalDialog, {
      props: { controller: { ...controller(), awaitingApproval: ref([pending]) } as unknown as WalletsController, workspaces: [] },
      global: { plugins: [createHronautI18n('en-US')] }
    })

    const section = screen.getByRole('region', { name: 'Typed data to sign' })
    expect(section).toHaveTextContent('AppVersion 2')
    expect(section).toHaveTextContent('Recipient0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD')
    expect(section).toHaveTextContent('Token amount 10x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238 · 2500000 (smallest token units)')
    expect(section).toHaveTextContent('Token amount 20x2000000000000000000000000000000000000002 · Amount not readable')
    expect(section).not.toHaveTextContent('Spender')
    expect(section).not.toHaveTextContent('Token allowance')
    expect(screen.getAllByRole('alert').map((alert) => alert.textContent?.trim())).toEqual([
      'Hronaut could not fully decode this request. Approval requires extra care.',
      'This is a token transfer authorization. Signing it lets the tokens be moved from your wallet to the recipient without another approval from you.',
      'Hronaut could not read every amount in this signature. Treat it as unlimited.'
    ])
  })

  it('warns that a typed-data marketplace order or Safe transaction can move assets', () => {
    const pending = request()
    pending.details = {
      ...pending.details!,
      understood: false,
      typedData: { primaryType: 'OrderComponents', domain: { name: 'Seaport', chainId: '1' }, warnings: ['asset-order'] }
    }
    const safe = request()
    safe.id = 'request-2'
    safe.details = {
      ...safe.details!,
      understood: false,
      typedData: { primaryType: 'SafeTx', domain: { chainId: '1' }, warnings: ['safe-transaction'] }
    }
    const view = render(WalletApprovalDialog, {
      props: { controller: { ...controller(), awaitingApproval: ref([pending]) } as unknown as WalletsController, workspaces: [] },
      global: { plugins: [createHronautI18n('en-US')] }
    })
    expect(screen.getAllByRole('alert').map((alert) => alert.textContent?.trim())).toEqual([
      'Hronaut could not fully decode this request. Approval requires extra care.',
      'This looks like a marketplace or exchange order. Once it is signed, anyone who fills it can take the tokens or NFTs it offers from this wallet.'
    ])
    view.unmount()
    render(WalletApprovalDialog, {
      props: { controller: { ...controller(), awaitingApproval: ref([safe]) } as unknown as WalletsController, workspaces: [] },
      global: { plugins: [createHronautI18n('en-US')] }
    })
    expect(screen.getAllByRole('alert').map((alert) => alert.textContent?.trim())).toContain(
      "This looks like a Safe multisig transaction or message. Once enough owners sign, it can move the Safe's assets or change its owners."
    )
  })

  it('names the token contract and spender of a token approval and warns about an unlimited amount', () => {
    const pending = request()
    pending.operation = 'sign-and-send-transaction'
    pending.details = {
      ...pending.details!,
      capability: 'send', method: 'erc20.approve', source: undefined,
      contract: '0x00000000000000000000000000000000000000Aa', destination: '0x0000000000000000000000000000000000000003',
      tokenAmount: (2n ** 256n - 1n).toString(), transactionWarnings: ['token-approval', 'unlimited-allowance']
    }
    render(WalletApprovalDialog, {
      props: { controller: { ...controller(), awaitingApproval: ref([pending]) } as unknown as WalletsController, workspaces: [] },
      global: { plugins: [createHronautI18n('en-US')] }
    })
    const dialog = screen.getByRole('alertdialog')
    const row = (label: string) => [...dialog.querySelectorAll('dt')].find((term) => term.textContent === label)?.nextElementSibling?.textContent
    expect(row('Token contract')).toBe('0x00000000000000000000000000000000000000Aa')
    expect(row('Spender')).toBe('0x0000000000000000000000000000000000000003')
    expect(row('Destination')).toBeUndefined()
    expect(screen.getAllByRole('alert').map((alert) => alert.textContent?.trim())).toEqual([
      'This is a token approval. It lets the spender move this token from your wallet later, up to the amount shown, without asking you again. On an NFT contract the amount is the ID of the one NFT it can move.',
      'The approved amount is unlimited, so the spender can move all of this token in your wallet, now or later. On an NFT contract it is instead a very large token ID.'
    ])
  })

  it('names the operator of a collection-wide NFT approval and warns about it', () => {
    const pending = request()
    pending.operation = 'sign-and-send-transaction'
    pending.details = {
      ...pending.details!,
      capability: 'send', method: 'nft.setApprovalForAll', source: undefined,
      contract: '0x00000000000000000000000000000000000000Bb', destination: '0x0000000000000000000000000000000000000004',
      transactionWarnings: ['collection-approval']
    }
    render(WalletApprovalDialog, {
      props: { controller: { ...controller(), awaitingApproval: ref([pending]) } as unknown as WalletsController, workspaces: [] },
      global: { plugins: [createHronautI18n('en-US')] }
    })
    const dialog = screen.getByRole('alertdialog')
    const row = (label: string) => [...dialog.querySelectorAll('dt')].find((term) => term.textContent === label)?.nextElementSibling?.textContent
    expect(row('Operator')).toBe('0x0000000000000000000000000000000000000004')
    expect(screen.getAllByRole('alert').map((alert) => alert.textContent?.trim())).toEqual([
      'This approves the operator for the whole collection. It can move every NFT this wallet holds from this contract, including ones it receives later, until the approval is revoked.'
    ])
  })

  it('shows why the transaction simulation reverted, when the contract says', () => {
    const shown = (simulationRevert?: NonNullable<WalletRequestSummary['details']>['simulationRevert']) => {
      const pending = request()
      pending.operation = 'sign-and-send-transaction'
      pending.details = {
        ...pending.details!, capability: 'send', method: 'erc20.transferFrom', simulationAttempted: true, simulationSuccess: false,
        ...(simulationRevert ? { simulationRevert } : {})
      }
      const view = render(WalletApprovalDialog, {
        props: { controller: { ...controller(), awaitingApproval: ref([pending]) } as unknown as WalletsController, workspaces: [] },
        global: { plugins: [createHronautI18n('en-US')] }
      })
      const dialog = screen.getByRole('alertdialog')
      const row = (label: string) => [...dialog.querySelectorAll('dt')].find((term) => term.textContent === label)?.nextElementSibling?.textContent
      const result = {
        simulation: row('Simulation'),
        reason: row('Revert reason'),
        contractText: dialog.querySelector('[data-testid="wallet-approval-revert-reason"] code')?.textContent
      }
      view.unmount()
      return result
    }
    // The contract's words sit in their own code element, apart from Hronaut's text.
    expect(shown({ kind: 'message', message: 'ERC20: insufficient allowance' })).toEqual({
      simulation: 'Failed', reason: 'ERC20: insufficient allowance', contractText: 'ERC20: insufficient allowance'
    })
    expect(shown({ kind: 'message', message: 'x'.repeat(200), truncated: true })).toEqual({
      simulation: 'Failed', reason: `${'x'.repeat(200)} (shortened)`, contractText: 'x'.repeat(200)
    })
    expect(shown({ kind: 'panic', code: '0x11', meaning: 'arithmetic overflow or underflow' })).toEqual({
      simulation: 'Failed', reason: 'Solidity panic 0x11: arithmetic overflow or underflow', contractText: undefined
    })
    expect(shown({ kind: 'panic', code: '0x99' }).reason).toBe('Solidity panic 0x99')
    expect(shown({ kind: 'custom-error', selector: '0xfb8f41b2', name: 'ERC20InsufficientAllowance' }).reason)
      .toBe('Custom error ERC20InsufficientAllowance (0xfb8f41b2)')
    expect(shown({ kind: 'custom-error', selector: '0x12345678' }).reason).toBe('Custom error 0x12345678')
    expect(shown({ kind: 'no-reason' }).reason).toBe('The contract reverted without a reason')
    // A page's message is shown as text, even when it looks like a translation placeholder.
    expect(shown({ kind: 'message', message: '{message} @:wallets.approval.failed | x' }).contractText).toBe('{message} @:wallets.approval.failed | x')
    expect(shown()).toEqual({ simulation: 'Failed', reason: undefined, contractText: undefined })
  })

  it('falls back to the immutable workspace ID when the workspace no longer exists', () => {
    const wallets = controller()
    render(WalletApprovalDialog, {
      props: { controller: wallets, workspaces: [] },
      global: { plugins: [createHronautI18n('en-US')] }
    })

    expect(screen.getByRole('alertdialog', { name: /sign message/i }))
      .toHaveTextContent('workspace-1')
  })

  it('requires fresh review focus when the next queued request replaces an approved request', async () => {
    Object.defineProperty(window, 'hronautShell', {
      configurable: true,
      value: { isWindowFocused: vi.fn(async () => true) }
    })
    const first = request()
    const second = request('request-2', 'Second wallet')
    const awaitingApproval = ref([first, second])
    const approve = vi.fn(async (requestId: string) => {
      awaitingApproval.value = awaitingApproval.value.filter((pending) => pending.id !== requestId)
    })
    const wallets = {
      awaitingApproval,
      busy: ref(false),
      errorMessage: ref(''),
      approve,
      reject: vi.fn(async () => undefined)
    } as unknown as WalletsController
    try {
      render(WalletApprovalDialog, {
        props: { controller: wallets, workspaces: [] },
        global: { plugins: [createHronautI18n('en-US')] }
      })
      const user = userEvent.setup()

      const firstApprove = screen.getByRole('button', { name: 'Approve exact request' })
      await user.click(firstApprove)
      await screen.findByText('Second wallet')
      const secondDialog = screen.getByRole('alertdialog', { name: /sign message/i })

      await vi.waitFor(() => expect(secondDialog).toHaveFocus())
      await user.keyboard('{Enter}')
      expect(approve).toHaveBeenCalledOnce()
      expect(approve).toHaveBeenCalledWith('request-1')
    } finally {
      Reflect.deleteProperty(window, 'hronautShell')
    }
  })

  it('takes clicks only once each request has finished appearing', async () => {
    const style = document.createElement('style')
    style.textContent = '.wallet-approval-dialog { animation-name: ui-surface-in; } .wallet-approval-dialog--entering { pointer-events: none; }'
    document.head.append(style)
    try {
      const queue = ref([request()])
      const wallets = { ...controller(), awaitingApproval: queue } as unknown as WalletsController
      render(WalletApprovalDialog, {
        props: { controller: wallets, workspaces: [] }, global: { plugins: [createHronautI18n('en-US')] }
      })
      const user = userEvent.setup()
      const dialog = screen.getByRole('alertdialog', { name: /sign message/i })
      const approve = screen.getByRole('button', { name: 'Approve exact request' })
      // While the dialog is still nearly transparent, a click aimed at the page must not approve it.
      await vi.waitFor(() => expect(getComputedStyle(dialog).pointerEvents).toBe('none'))
      await expect(user.click(approve)).rejects.toThrow(/pointer-events/u)
      // A child's own animation does not end the dialog's entrance.
      approve.dispatchEvent(new Event('animationend', { bubbles: true }))
      expect(dialog).toHaveClass('wallet-approval-dialog--entering')

      dialog.dispatchEvent(new Event('animationend'))
      await vi.waitFor(() => expect(dialog).not.toHaveClass('wallet-approval-dialog--entering'))
      await user.click(approve)
      expect(wallets.approve).toHaveBeenCalledWith('request-1')

      // The next request appears again before it takes clicks.
      queue.value = [request('request-2', 'Second wallet')]
      await screen.findByText('Second wallet')
      const next = screen.getByRole('alertdialog', { name: /sign message/i })
      expect(next).toHaveClass('wallet-approval-dialog--entering')
      // The replaced section's cancelled animation does not end the new request's entrance.
      dialog.dispatchEvent(new Event('animationcancel'))
      await Promise.resolve()
      expect(next).toHaveClass('wallet-approval-dialog--entering')
    } finally {
      style.remove()
    }
  })

  it('stops waiting for an entrance that never ends, counting only time on screen', async () => {
    vi.useFakeTimers()
    const style = document.createElement('style')
    style.textContent = '.wallet-approval-dialog { animation-name: ui-surface-in; }'
    document.head.append(style)
    let visibility: DocumentVisibilityState = 'visible'
    const visibilityState = vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
    try {
      render(WalletApprovalDialog, {
        props: { controller: controller(), workspaces: [] }, global: { plugins: [createHronautI18n('en-US')] }
      })
      const dialog = screen.getByRole('alertdialog', { name: /sign message/i })
      await vi.advanceTimersByTimeAsync(1_000)
      expect(dialog).toHaveClass('wallet-approval-dialog--entering')
      // Animations stop in a hidden window, and the click that brings it back must not land on a transparent dialog.
      visibility = 'hidden'
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(5_000)
      expect(dialog).toHaveClass('wallet-approval-dialog--entering')
      visibility = 'visible'
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(1_499)
      expect(dialog).toHaveClass('wallet-approval-dialog--entering')
      await vi.advanceTimersByTimeAsync(1)
      expect(dialog).not.toHaveClass('wallet-approval-dialog--entering')
    } finally {
      visibilityState.mockRestore()
      style.remove()
      vi.useRealTimers()
    }
  })
})

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
    expect(reject).toHaveFocus()
    background.focus()
    expect(dialog.contains(document.activeElement)).toBe(true)
    background.remove()
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
})

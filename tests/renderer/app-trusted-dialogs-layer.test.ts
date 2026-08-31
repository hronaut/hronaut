import { mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import AppTrustedDialogsLayer from '../../src/renderer/src/components/AppTrustedDialogsLayer.vue'
import HelpDialog from '../../src/renderer/src/components/HelpDialog.vue'
import SettingsDialog from '../../src/renderer/src/components/SettingsDialog.vue'
import WalletApprovalDialog from '../../src/renderer/src/components/WalletApprovalDialog.vue'

describe('AppTrustedDialogsLayer', () => {
  it('owns trusted dialog composition and keeps controller wiring reactive', async () => {
    const updateState = ref({ currentVersion: '1.9.11' })
    const controllers = {
      searchSettingsController: { id: 'search' },
      downloadSettingsController: { id: 'downloads' },
      performanceSettingsController: { id: 'performance' },
      mcpSettingsController: { id: 'mcp' },
      privacySettingsController: { id: 'privacy' },
      sitePermissionsController: { id: 'permissions' },
      credentialsController: { id: 'credentials' },
      updateSettingsController: { id: 'updates', state: updateState },
      releaseHistoryController: { id: 'release-history' },
      commercialLicenseController: { id: 'support' },
      settingsDialogController: { id: 'settings-dialog' },
      walletsController: { id: 'wallets' }
    }
    const helpController = { id: 'help-dialog' }
    const workspaces = [{ id: 'workspace-1', name: 'Primary' }]
    const formatBytes = vi.fn(String)
    const formatNumber = vi.fn(String)
    const formatDateTime = vi.fn(String)
    const testSound = vi.fn()
    const reportSettingError = vi.fn()
    const openUrl = vi.fn(async () => undefined)
    const purchaseCommercialLicense = vi.fn()
    const openSupportSettings = vi.fn()
    const reportLayout = vi.fn()

    const wrapper = mount(AppTrustedDialogsLayer, {
      shallow: true,
      props: {
        settingsController: controllers as never,
        helpController: helpController as never,
        workspaces,
        formatBytes,
        formatNumber,
        formatDateTime,
        testSound,
        reportSettingError,
        openUrl,
        purchaseCommercialLicense,
        openSupportSettings,
        reportLayout
      }
    })

    const settings = wrapper.findComponent(SettingsDialog)
    expect(settings.props()).toMatchObject({
      controller: controllers.settingsDialogController,
      searchController: controllers.searchSettingsController,
      downloadController: controllers.downloadSettingsController,
      performanceController: controllers.performanceSettingsController,
      mcpController: controllers.mcpSettingsController,
      privacyController: controllers.privacySettingsController,
      permissionsController: controllers.sitePermissionsController,
      credentialsController: controllers.credentialsController,
      updateController: controllers.updateSettingsController,
      supportController: controllers.commercialLicenseController,
      walletsController: controllers.walletsController,
      workspaces,
      formatBytes,
      formatNumber,
      formatDateTime,
      testSound,
      reportSettingError,
      openUrl,
      purchaseCommercialLicense
    })

    expect(wrapper.findComponent(WalletApprovalDialog).props('controller'))
      .toBe(controllers.walletsController)
    expect(wrapper.findComponent(HelpDialog).props()).toMatchObject({
      controller: helpController,
      currentVersion: '1.9.11',
      openUrl,
      openSupportSettings,
      reportLayout
    })

    updateState.value = { currentVersion: '1.10.0' }
    await nextTick()
    expect(wrapper.findComponent(HelpDialog).props('currentVersion')).toBe('1.10.0')
  })
})

import type { Meta, StoryObj } from '@storybook/vue3-vite'
import UiButton from './UiButton.vue'
import UiField from './UiField.vue'
import UiNotice from './UiNotice.vue'
import UiSettingRow from './UiSettingRow.vue'

const themes = ['light', 'dark', 'midnight', 'sepia', 'cyberpunk', 'matrix', 'machine', 'galactic'] as const

const meta = {
  title: 'UI/Primitives',
  component: UiButton,
  tags: ['autodocs']
} satisfies Meta<typeof UiButton>

export default meta
type Story = StoryObj<typeof meta>

export const States: Story = {
  render: () => ({
    components: { UiButton, UiField, UiNotice, UiSettingRow },
    template: `
      <div class="ui-primitives-grid">
        <div class="ui-primitives-row">
          <UiButton variant="primary">Primary action</UiButton>
          <UiButton>Secondary action</UiButton>
          <UiButton variant="danger">Danger action</UiButton>
          <UiButton variant="ghost">Ghost action</UiButton>
          <UiButton disabled>Disabled</UiButton>
          <UiButton busy>Working</UiButton>
        </div>
        <UiField label="Workspace name" for-id="workspace-name" hint="Names are stored locally.">
          <input id="workspace-name" value="Research" />
        </UiField>
        <UiNotice tone="success">The workspace is ready.</UiNotice>
        <UiNotice tone="warning">This action affects the active tab.</UiNotice>
        <UiNotice tone="danger">The operation could not be completed.</UiNotice>
        <UiSettingRow label="Require authentication" description="Protect the local MCP endpoint.">
          <input type="checkbox" checked aria-label="Require authentication" />
        </UiSettingRow>
      </div>
    `
  })
}

export const ThemeGallery: Story = {
  parameters: { controls: { disable: true } },
  render: () => ({
    components: { UiButton, UiNotice },
    setup: () => ({ themes }),
    template: `
      <div class="ui-theme-gallery">
        <section v-for="theme in themes" :key="theme" class="ui-theme-scope" :data-theme="theme">
          <strong>{{ theme }}</strong>
          <div class="ui-primitives-row">
            <UiButton variant="primary">Continue</UiButton>
            <UiButton>Cancel</UiButton>
          </div>
          <UiNotice tone="warning" style="margin-top: 12px">Review required.</UiNotice>
        </section>
      </div>
    `
  })
}

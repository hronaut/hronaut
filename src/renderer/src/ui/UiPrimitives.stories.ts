import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import UiButton from './UiButton.vue'
import UiCheckbox from './UiCheckbox.vue'
import UiDialog from './UiDialog.vue'
import UiEmptyState from './UiEmptyState.vue'
import UiField from './UiField.vue'
import UiIconButton from './UiIconButton.vue'
import UiInput from './UiInput.vue'
import UiMenu from './UiMenu.vue'
import UiNotice from './UiNotice.vue'
import UiPopover from './UiPopover.vue'
import UiSegmentedControl from './UiSegmentedControl.vue'
import UiSelect from './UiSelect.vue'
import UiSettingRow from './UiSettingRow.vue'
import UiSpinner from './UiSpinner.vue'
import UiSwitch from './UiSwitch.vue'
import UiTabs from './UiTabs.vue'
import UiTextarea from './UiTextarea.vue'
import UiToggleButton from './UiToggleButton.vue'
import UiTooltip from './UiTooltip.vue'

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
    components: { UiButton, UiCheckbox, UiField, UiIconButton, UiInput, UiNotice, UiSelect, UiSettingRow, UiSpinner, UiSwitch, UiTextarea, UiToggleButton, UiTooltip },
    setup: () => ({ checked: ref(true), enabled: ref(false), name: ref('Research'), role: ref('owner'), pressed: ref(false) }),
    template: `
      <div class="ui-primitives-grid">
        <div class="ui-primitives-row">
          <UiButton variant="primary">Primary action</UiButton>
          <UiButton>Secondary action</UiButton>
          <UiButton variant="danger">Danger action</UiButton>
          <UiButton variant="ghost">Ghost action</UiButton>
          <UiButton disabled>Disabled</UiButton>
          <UiButton busy loading-label="Saving">Working</UiButton>
          <UiIconButton label="Add workspace">+</UiIconButton>
          <UiToggleButton :pressed="pressed" @change="pressed = $event">Pinned</UiToggleButton>
          <UiTooltip text="Stored only on this device"><UiIconButton label="Privacy information">?</UiIconButton></UiTooltip>
        </div>
        <UiField label="Workspace name" hint="Names are stored locally." required>
          <UiInput v-model="name" autocomplete="off" />
        </UiField>
        <UiField label="Role"><UiSelect v-model="role"><option value="owner">Owner</option><option value="viewer">Viewer</option></UiSelect></UiField>
        <UiField label="Navigation rules" error="Enter at least one allowed origin."><UiTextarea /></UiField>
        <UiCheckbox v-model="checked" label="Remember this workspace" />
        <UiSwitch v-model="enabled" label="Require authentication" description="Protect the local MCP endpoint." />
        <UiSpinner label="Loading workspace" />
        <UiNotice tone="success">The workspace is ready.</UiNotice>
        <UiNotice tone="warning">This action affects the active tab.</UiNotice>
        <UiNotice tone="danger" role="alert">The operation could not be completed.</UiNotice>
        <UiSettingRow label="Require authentication" description="Protect the local MCP endpoint." group>
          <UiSwitch v-model="enabled" label="Require authentication" />
        </UiSettingRow>
      </div>
    `
  })
}

export const CompositePatterns: Story = {
  render: () => ({
    components: { UiButton, UiDialog, UiEmptyState, UiMenu, UiPopover, UiSegmentedControl, UiTabs },
    setup: () => ({
      dialogOpen: ref(false),
      menuOpen: ref(false),
      activeTab: ref('general'),
      density: ref('comfortable'),
      tabs: [{ id: 'general', label: 'General' }, { id: 'privacy', label: 'Privacy' }],
      densities: [{ value: 'compact', label: 'Compact' }, { value: 'comfortable', label: 'Comfortable' }],
      menuItems: [{ id: 'rename', label: 'Rename' }, { id: 'delete', label: 'Delete', danger: true }]
    }),
    template: `
      <div class="ui-primitives-grid">
        <div class="ui-primitives-row">
          <UiButton variant="primary" @click="dialogOpen = true">Open dialog</UiButton>
          <UiMenu v-model:open="menuOpen" label="Workspace actions" :items="menuItems" />
          <UiPopover label="Workspace details"><template #trigger>Details</template><p style="margin: 0">Stored locally.</p></UiPopover>
          <UiSegmentedControl v-model="density" label="Density" :options="densities" />
        </div>
        <UiTabs v-model="activeTab" label="Settings" :items="tabs"><p>Active panel: {{ activeTab }}</p></UiTabs>
        <UiEmptyState title="No workspaces yet" description="Create an isolated workspace for your next agent task.">
          <template #actions><UiButton variant="primary">Create workspace</UiButton></template>
        </UiEmptyState>
        <UiDialog v-model:open="dialogOpen" title="Create workspace" description="Workspaces keep browser state isolated.">
          <p>Dialog content</p>
          <template #footer="{ close }"><UiButton @click="close">Cancel</UiButton><UiButton variant="primary" @click="close">Create</UiButton></template>
        </UiDialog>
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

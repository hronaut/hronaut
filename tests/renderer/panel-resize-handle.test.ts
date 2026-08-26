import { fireEvent, render, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import PanelResizeHandle from '../../src/renderer/src/components/PanelResizeHandle.vue'

describe('PanelResizeHandle', () => {
  it('presents its current dock range and delegates pointer, keyboard, and reset input', async () => {
    const view = render(PanelResizeHandle, {
      props: {
        dock: 'left',
        active: true,
        minimum: 280,
        maximum: 640,
        value: 420,
        label: 'Resize panel',
        title: 'Drag or use arrow keys'
      }
    })
    const separator = screen.getByRole('separator', { name: 'Resize panel' })

    expect(separator).toHaveAttribute('aria-orientation', 'vertical')
    expect(separator).toHaveAttribute('aria-valuemin', '280')
    expect(separator).toHaveAttribute('aria-valuemax', '640')
    expect(separator).toHaveAttribute('aria-valuenow', '420')
    expect(separator).toHaveAttribute('title', 'Drag or use arrow keys')
    expect(separator).toHaveClass('active')

    await fireEvent.pointerDown(separator)
    await fireEvent.keyDown(separator, { key: 'ArrowRight' })
    await fireEvent.dblClick(separator)

    expect(view.emitted().pointerdown).toHaveLength(1)
    expect(view.emitted().keydown).toHaveLength(1)
    expect(view.emitted().reset).toHaveLength(1)
  })

  it('uses horizontal separator semantics for top and bottom docks', async () => {
    const view = render(PanelResizeHandle, {
      props: {
        dock: 'top',
        active: false,
        minimum: 180,
        maximum: 500,
        value: 260,
        label: 'Resize panel',
        title: 'Resize help'
      }
    })

    expect(screen.getByRole('separator')).toHaveAttribute('aria-orientation', 'horizontal')
    await view.rerender({ dock: 'bottom' })
    expect(screen.getByRole('separator')).toHaveAttribute('aria-orientation', 'horizontal')
  })
})

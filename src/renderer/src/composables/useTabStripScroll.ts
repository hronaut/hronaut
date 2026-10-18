import { ref, type Ref } from 'vue'

interface TabStripScrollOptions {
  /** The rail lists tabs top to bottom; the horizontal strip lists them left to right. */
  vertical: Readonly<Ref<boolean>>
  /** The tab keyboard focus last moved to, which a layout pass keeps in view. */
  focusedTabId: Readonly<Ref<string | null>>
}

/**
 * Scrolling the tab strip or rail: whether its tabs overflow and which way it can still scroll, the scroll buttons and
 * the wheel, and keeping the active or focused tab in view through scrolling and resizing.
 */
export function useTabStripScroll(options: TabStripScrollOptions) {
  const { vertical, focusedTabId } = options
  const tabsStrip = ref<HTMLElement | null>(null)
  const hasTabOverflow = ref(false)
  const canScrollTabsBack = ref(false)
  const canScrollTabsForward = ref(false)
  let tabsStripResizeObserver: ResizeObserver | undefined
  let activeVisibleBeforeResize = true
  let tabStripWidth = 0
  let tabStripHeight = 0

  function updateTabOverflow(): void {
    const strip = tabsStrip.value
    if (!strip) return
    const contentExtent = vertical.value ? strip.scrollHeight : strip.scrollWidth
    const viewportExtent = vertical.value ? strip.clientHeight : strip.clientWidth
    // Scroll controls reserve space outside the scrolling viewport. Compare
    // content against the full shell so those controls cannot keep themselves
    // alive after tabs shrink enough to fit without them.
    const shellExtent = vertical.value
      ? strip.parentElement?.clientHeight
      : strip.parentElement?.clientWidth
    const overflowCapacity = shellExtent && shellExtent > 0 ? shellExtent : viewportExtent
    const overflowing = contentExtent - overflowCapacity > 1
    const maximumScroll = Math.max(0, contentExtent - viewportExtent)
    hasTabOverflow.value = overflowing
    if (!overflowing) {
      canScrollTabsBack.value = false
      canScrollTabsForward.value = false
      return
    }
    const position = vertical.value ? strip.scrollTop : strip.scrollLeft
    canScrollTabsBack.value = position > 1
    canScrollTabsForward.value = position < maximumScroll - 1
  }

  function scrollTabs(direction: -1 | 1): void {
    const strip = tabsStrip.value
    if (!strip) return
    const distance = direction * Math.max(180, (vertical.value ? strip.clientHeight : strip.clientWidth) * 0.72)
    strip.scrollBy(vertical.value ? { top: distance, behavior: 'smooth' } : { left: distance, behavior: 'smooth' })
  }

  function scrollTabsWithWheel(event: WheelEvent): void {
    const strip = tabsStrip.value
    if (!strip || !hasTabOverflow.value || event.ctrlKey || (!vertical.value && Math.abs(event.deltaX) >= Math.abs(event.deltaY))) return
    let unit = 1
    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
      const lineHeight = Number.parseFloat(getComputedStyle(strip).lineHeight)
      unit = Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : 16
    } else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
      unit = vertical.value ? strip.clientHeight : strip.clientWidth
    }
    event.preventDefault()
    if (vertical.value) strip.scrollTop += (event.deltaY || event.deltaX) * unit
    else strip.scrollLeft += event.deltaY * unit
    updateTabOverflow()
  }

  function revealTab(activeTab: HTMLElement, behavior?: ScrollBehavior): void {
    const strip = tabsStrip.value
    if (!strip) return

    const stripBounds = strip.getBoundingClientRect()
    const tabBounds = activeTab.getBoundingClientRect()
    const availableSpan = vertical.value ? stripBounds.height - tabBounds.height : stripBounds.width - tabBounds.width
    const header = activeTab.closest('.workspace-tab-section')?.querySelector('.tab-group-label')
    // A sticky header already occupies the leading edge; never reserve its own
    // space when it receives focus (including after a rail resize).
    const isHeader = activeTab === header
    // A vertical neighbor needs a whole tab row plus its gap. A fixed 31px
    // clearance clips the next 34px row in short, enlarged interface layouts.
    const desiredMargin = vertical.value ? tabBounds.height + 4 : 31
    const margin = isHeader ? 0 : Math.min(desiredMargin, Math.max(0, availableSpan / 2))
    const leadingEdge = vertical.value ? tabBounds.top : tabBounds.left
    const trailingEdge = vertical.value ? tabBounds.bottom : tabBounds.right
    const headerBounds = header?.getBoundingClientRect()
    const headerExtent = headerBounds && !isHeader ? (vertical.value ? headerBounds.height : headerBounds.width) : 0
    // A tight horizontal strip may fit the header, tab and trailing clearance
    // only with a smaller gap. Keep at least two pixels of header separation
    // instead of spending those pixels at the expense of the trailing edge.
    const headerGap = vertical.value ? 4 : Math.min(4, Math.max(2, availableSpan - headerExtent - margin))
    const headerSpace = headerExtent > 0 ? headerExtent + headerGap : 0
    const leadingMargin = Math.max(margin, Math.min(headerSpace, Math.max(0, availableSpan)))
    const trailingMargin = Math.min(margin, Math.max(0, availableSpan - leadingMargin))
    const visibleLeadingEdge = (vertical.value ? stripBounds.top : stripBounds.left) + leadingMargin
    const visibleTrailingEdge = (vertical.value ? stripBounds.bottom : stripBounds.right) - trailingMargin
    const correction = leadingEdge < visibleLeadingEdge
      ? leadingEdge - visibleLeadingEdge
      : trailingEdge > visibleTrailingEdge
        ? trailingEdge - visibleTrailingEdge
        : 0
    if (Math.abs(correction) > 1 && typeof strip.scrollBy === 'function') {
      strip.scrollBy(vertical.value ? { top: correction, behavior } : { left: correction, behavior })
      return
    }
    if (typeof activeTab.scrollIntoView === 'function') {
      activeTab.scrollIntoView({ ...(behavior ? { behavior } : {}), block: 'nearest', inline: 'nearest' })
    }
  }

  function revealActiveTab(behavior: ScrollBehavior = 'auto'): void {
    const activeTab = tabsStrip.value?.querySelector<HTMLElement>('[data-active-tab="true"]')
    if (activeTab) revealTab(activeTab, behavior)
  }

  function activeTabIntersectsVisibleStrip(): boolean {
    const strip = tabsStrip.value
    const activeTab = strip?.querySelector<HTMLElement>('[data-active-tab="true"]')
    if (!strip || !activeTab) return false
    const stripBounds = strip.getBoundingClientRect()
    const tabBounds = activeTab.getBoundingClientRect()
    return vertical.value
      ? tabBounds.bottom >= stripBounds.top - 1 && tabBounds.top <= stripBounds.bottom + 1
      : tabBounds.right >= stripBounds.left - 1 && tabBounds.left <= stripBounds.right + 1
  }

  function focusedStripControl(): HTMLElement | undefined {
    const focused = document.activeElement
    return focused instanceof HTMLElement && tabsStrip.value?.contains(focused) ? focused : undefined
  }

  function revealAfterLayout(revealActive = true): void {
    // Expanding the rail can resize it after keyboard navigation has revealed a
    // different tab. Preserve the user's current control through that layout pass.
    const focused = focusedStripControl()
    // A newer selection supersedes stale DOM focus, and an unfocused window
    // must follow its active page rather than a previously focused control.
    const focusedTab = focused?.dataset.tabId
    if (document.hasFocus() && focused && (!focusedTab || focusedTab === focusedTabId.value)) revealTab(focused, 'auto')
    else if (revealActive) revealActiveTab('auto')
  }

  function handleTabStripResize(): void {
    updateTabOverflow()
    revealAfterLayout(activeVisibleBeforeResize)
    tabStripWidth = tabsStrip.value?.clientWidth ?? 0
    tabStripHeight = tabsStrip.value?.clientHeight ?? 0
  }

  function handleTabStripScroll(): void {
    updateTabOverflow()
    // A passive reveal or resize must not undo scrolling away from the selected
    // page. Genuine tab selection and keyboard focus still reveal their target.
    const strip = tabsStrip.value
    // Resizing can dispatch scroll before ResizeObserver. Keep the visibility
    // from the previous layout instead of mistaking that scroll for user intent.
    if (strip?.clientWidth === tabStripWidth && strip.clientHeight === tabStripHeight) {
      activeVisibleBeforeResize = activeTabIntersectsVisibleStrip()
    }
  }

  /** The active tab changed and is revealed next, so a resize that follows keeps it in view. */
  function markActiveTabVisible(): void {
    activeVisibleBeforeResize = true
  }

  /** Follows the strip's size once it is mounted. */
  function observeStrip(): void {
    tabStripWidth = tabsStrip.value?.clientWidth ?? 0
    tabStripHeight = tabsStrip.value?.clientHeight ?? 0
    if (typeof ResizeObserver !== 'undefined' && tabsStrip.value) {
      tabsStripResizeObserver = new ResizeObserver(handleTabStripResize)
      tabsStripResizeObserver.observe(tabsStrip.value)
    }
  }

  function stopObservingStrip(): void {
    tabsStripResizeObserver?.disconnect()
  }

  return {
    tabsStrip,
    hasTabOverflow,
    canScrollTabsBack,
    canScrollTabsForward,
    updateTabOverflow,
    scrollTabs,
    scrollTabsWithWheel,
    revealTab,
    revealActiveTab,
    activeTabIntersectsVisibleStrip,
    revealAfterLayout,
    handleTabStripScroll,
    markActiveTabVisible,
    observeStrip,
    stopObservingStrip
  }
}

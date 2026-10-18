import {
  AGENT_CARD_EDGE,
  AGENT_CARD_GAP,
  AGENT_CARD_MAX_HEIGHT,
  AGENT_CARD_MAX_WIDTH,
  AGENT_CARD_SHADOW_ROOM,
  AGENT_CARD_TOP_ROOM,
  type AgentCardCloseReason,
  type AgentCardEvent,
  type AgentCardMeasurement,
  type AgentCardShowRequest,
  type AgentCardState,
  type AgentCardViewMessage
} from '../shared/agent-card.js'
import type { ShellTooltipRect } from '../shared/shell-tooltip.js'

/**
 * What keeps Follow from switching tabs to agent activity, created once by index.ts: the shell's request and an open
 * agent card. The shell IPC and the card's openChanged port each set their own flag and read both when they run, and
 * the tab runtime follows only while neither is set.
 */
export interface FollowSuspensionState {
  /** Whether the shell asked to stop following agent activity, as it last reported. */
  shellSuspended: boolean
  /** Whether an agent card is open; Follow would switch tabs under it. */
  agentCardOpen: boolean
}

/** The native view that draws the agent card above the page views. */
export interface AgentCardSurface {
  send(state: AgentCardState): void
  setZoomFactor(zoom: number): void
  setBounds(bounds: ShellTooltipRect): void
  /** Shows the view as the topmost child of the main window. */
  present(): void
  withdraw(): void
  /** Gives the card keyboard focus. */
  focus(): void
  isFocused(): boolean
  isDestroyed(): boolean
}

export interface AgentCardOverlayPorts {
  /** Creates the view on first use; later calls return the same loaded view. */
  surface(): Promise<AgentCardSurface>
  /** The main window's content size in window coordinates, or null while it cannot show a card. */
  windowSize(): { width: number; height: number } | null
  emit(event: AgentCardEvent): void
  /** Returns keyboard focus to the shell, which focuses the avatar again. */
  focusShell(): void
  /** The card appeared or went away; Follow waits while it is open. */
  openChanged(open: boolean): void
  /** Which contents has keyboard focus now, to notice the user moving on before a card appears. */
  focusOwner(): unknown
}

interface OpenCard {
  cardId: number
  revision: number
  generation: number
  anchor: ShellTooltipRect
  zoom: number
  presented: boolean
  /** Who had keyboard focus when the card was asked for. */
  focusOwner: unknown
}

function scaled(rect: ShellTooltipRect, zoom: number): ShellTooltipRect {
  return { x: rect.x * zoom, y: rect.y * zoom, width: rect.width * zoom, height: rect.height * zoom }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum))
}

/**
 * Places a card of `size` under `anchor`, centered on it and kept inside `area`; above it when
 * only that side has room. When neither side fits, it goes below, as tall as the room there.
 * Above the anchor it keeps `gapAbove`, so the shadow under the card stays off the anchor.
 */
export function placeAgentCard(
  anchor: ShellTooltipRect,
  size: { width: number; height: number },
  area: { width: number; height: number },
  gap: number,
  edge: number,
  gapAbove = gap
): ShellTooltipRect {
  const width = Math.min(size.width, Math.max(1, area.width - edge * 2))
  const x = clamp(anchor.x + (anchor.width - width) / 2, edge, area.width - edge - width)
  const below = anchor.y + anchor.height + gap
  const above = anchor.y - gapAbove - size.height
  if (below + size.height > area.height - edge && above >= edge) {
    return { x: Math.round(x), y: Math.round(above), width: Math.ceil(width), height: Math.ceil(size.height) }
  }
  const height = Math.max(1, Math.min(size.height, area.height - edge - below))
  return { x: Math.round(x), y: Math.round(below), width: Math.ceil(width), height: Math.ceil(height) }
}

/**
 * Shows one agent card at a time in a transparent native view above the page views. The shell
 * opens and updates it with the avatar's box and content; the view measures it; main places it
 * under the avatar, gives it focus, and reports actions and its closing back to the shell.
 */
export class AgentCardOverlay {
  private card: OpenCard | null = null
  private current: AgentCardSurface | null = null
  private generation = 0
  private revision = 0
  private disposed = false
  // The shell numbers cards upward. A card that closed, was hidden or was replaced never opens
  // again: an update the shell sent before it heard of the closing must not bring it back.
  private endedCardId = 0

  constructor(private readonly ports: AgentCardOverlayPorts) {}

  get openCardId(): number | undefined {
    return this.card?.cardId
  }

  /** Opens a card, or updates the open one with the same cardId. `zoom` turns the shell's CSS pixels into window coordinates. */
  show(request: AgentCardShowRequest, zoom: number): void {
    if (this.disposed || request.cardId <= this.endedCardId) return
    const previous = this.card
    const updating = previous?.cardId === request.cardId
    if (previous && !updating) {
      this.ended(previous.cardId)
      this.withdraw(previous)
    }
    const generation = ++this.generation
    const revision = ++this.revision
    this.card = {
      cardId: request.cardId,
      revision,
      generation,
      anchor: scaled(request.anchor, zoom),
      zoom,
      presented: updating && previous.presented,
      focusOwner: updating ? previous.focusOwner : this.ports.focusOwner()
    }
    void this.ports.surface().then((surface) => {
      if (this.disposed || this.card?.generation !== generation || surface.isDestroyed()) return
      this.current = surface
      surface.setZoomFactor(zoom)
      surface.send({ cardId: request.cardId, revision, theme: request.theme, model: request.model })
    }).catch((error: unknown) => {
      console.error('[agent card] Failed to show the card:', error)
      if (this.card?.generation === generation) this.close('lost')
    })
  }

  /** The view laid out this card revision; place it under the avatar and, the first time, focus it. */
  measured(measurement: AgentCardMeasurement): void {
    const card = this.card
    const surface = this.current
    if (this.disposed || !card || measurement.cardId !== card.cardId || measurement.revision !== card.revision || !surface || surface.isDestroyed()) return
    const area = this.ports.windowSize()
    if (!area) return
    if (!card.presented && this.ports.focusOwner() !== card.focusOwner) {
      // The user clicked or typed elsewhere while the card was loading; it no longer answers that.
      this.close('blur')
      return
    }
    const room = AGENT_CARD_SHADOW_ROOM * card.zoom
    const top = AGENT_CARD_TOP_ROOM * card.zoom
    // The view reports its own size; never trust it to cover more than a card's largest box.
    const box = placeAgentCard(
      card.anchor,
      { width: Math.min(measurement.width, AGENT_CARD_MAX_WIDTH) * card.zoom, height: Math.min(measurement.height, AGENT_CARD_MAX_HEIGHT) * card.zoom },
      area,
      AGENT_CARD_GAP * card.zoom,
      AGENT_CARD_EDGE * card.zoom,
      room
    )
    // A native view takes every click in its box, even where it is transparent: its top edge stays
    // at or below the avatar, and above the avatar its bottom edge stays at or above it.
    surface.setBounds({
      x: Math.round(box.x - room),
      y: Math.round(box.y - top),
      width: Math.ceil(box.width + room * 2),
      height: Math.ceil(box.height + top + room)
    })
    if (card.presented) {
      this.presentKeepingFocus(surface)
      return
    }
    surface.present()
    card.presented = true
    surface.focus()
    this.ports.openChanged(true)
  }

  /** The shell could not describe this card within the contract; whatever is open closes, and the shell resets. */
  refused(cardId: number): void {
    const open = this.card
    this.ended(cardId)
    if (open) this.close('lost')
    if (open?.cardId !== cardId) this.ports.emit({ cardId, kind: 'closed', reason: 'lost' })
  }

  /** A message from the card view, for the open card only. */
  received(message: AgentCardViewMessage): void {
    const card = this.card
    if (this.disposed || !card?.presented || message.cardId !== card.cardId) return
    if (message.kind === 'action') {
      this.ports.emit({
        cardId: card.cardId,
        kind: 'action',
        action: message.action,
        ...(message.key === undefined ? {} : { key: message.key }),
        ...(message.note === undefined ? {} : { note: message.note })
      })
    }
    else this.close(message.reason)
  }

  /** The shell closed the card with this id, or whichever is open when no id is given. */
  hide(cardId?: number): void {
    const card = this.card
    if (!card || (cardId !== undefined && card.cardId !== cardId)) return
    const hadFocus = this.current?.isFocused() === true
    this.card = null
    this.generation += 1
    this.ended(card.cardId)
    this.withdraw(card)
    if (hadFocus) this.ports.focusShell()
  }

  /** A new shell document numbers its cards from the start again; any open card goes. */
  shellReset(): void {
    this.hide()
    this.endedCardId = 0
  }

  /** The window moved, resized or went to the background: the card closes as if focus left it. */
  dismiss(): void {
    if (this.card) this.close('blur')
  }

  /** A page view attached meanwhile would cover the card; put it back on top, keeping its focus. */
  restack(): void {
    const surface = this.current
    if (!this.card?.presented || !surface || surface.isDestroyed()) return
    this.presentKeepingFocus(surface)
  }

  // Putting the view back on top, above a tooltip or a page view, can drop its keyboard focus.
  private presentKeepingFocus(surface: AgentCardSurface): void {
    const hadFocus = surface.isFocused()
    surface.present()
    if (hadFocus && !surface.isFocused()) surface.focus()
  }

  /**
   * The card's view lost keyboard focus: a click on the page or the shell, or another view took it.
   * The card closes unless it has focus again once the current task ends, as after a restack.
   */
  blurred(): void {
    const card = this.card
    if (!card?.presented) return
    queueMicrotask(() => {
      if (this.card === card && this.current?.isFocused() !== true) this.close('blur')
    })
  }

  /** The view is gone, such as after its renderer exited; the next card creates a new one. */
  surfaceLost(): void {
    this.current = null
    if (this.card) this.close('lost')
  }

  dispose(): void {
    const card = this.card
    this.card = null
    this.generation += 1
    if (card) this.withdraw(card)
    this.disposed = true
    this.current = null
  }

  private close(reason: AgentCardCloseReason): void {
    const card = this.card
    if (!card) return
    this.card = null
    this.generation += 1
    this.ended(card.cardId)
    this.withdraw(card)
    this.ports.emit({ cardId: card.cardId, kind: 'closed', reason })
    if (reason === 'escape') this.ports.focusShell()
  }

  private ended(cardId: number): void {
    this.endedCardId = Math.max(this.endedCardId, cardId)
  }

  private withdraw(card: OpenCard): void {
    if (this.current && !this.current.isDestroyed()) this.current.withdraw()
    if (card.presented) this.ports.openChanged(false)
  }
}

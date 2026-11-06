let pressedOutside = false

/**
 * Runs a shortcut main sends the shell because it was pressed outside Hronaut's window, as in a page, or chosen from the
 * application menu. Main gives the shell the keyboard first, so the shell's own focus no longer says where it was.
 */
export function runShortcutPressedOutside<T>(run: () => T): T {
  pressedOutside = true
  try {
    return run()
  } finally {
    pressedOutside = false
  }
}

/** Whether the shortcut that is running now, up to its first wait, was pressed outside Hronaut's window. */
export function shortcutPressedOutside(): boolean {
  return pressedOutside
}

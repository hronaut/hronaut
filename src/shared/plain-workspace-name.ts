/**
 * Line breaks, tabs and other control characters; a subdivision flag such as England's, which is made of invisible tag
 * characters; and the invisible formatting characters a name does not need. Joiners and direction marks stay, since
 * emoji and names in some scripts need them, and so do the Arabic signs that are drawn.
 */
const UNSAFE_NAME_CHARACTERS = /(\u{1F3F4}[\u{E0030}-\u{E0039}\u{E0061}-\u{E007A}]{1,6}\u{E007F})|([\p{Cc}\p{Zl}\p{Zp}]+)|(?![\u200C-\u200F\u061C\u0600-\u0605\u06DD\u070F\u08E2])\p{Cf}/gu

/**
 * A workspace name as Hronaut keeps and shows it: one line, NFC-normalized and trimmed, without control characters or
 * invisible formatting characters. An agent can name a workspace, and those could add a paragraph to a dialog that
 * names it, reverse the words after them, or hide text in the name. Control characters become a space, and invisible
 * formatting characters are removed. The result may be empty.
 */
export function plainWorkspaceName(name: string): string {
  return name.normalize('NFC')
    .replace(UNSAFE_NAME_CHARACTERS, (_match, flag: string | undefined, control: string | undefined) => flag ?? (control ? ' ' : ''))
    .trim()
}

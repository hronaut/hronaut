/**
 * The channel a website tab's preload reports its page's print dialog on: true when the browser's beforeprint fires,
 * false on afterprint. The main process uses it to stop waiting on a page the dialog holds.
 */
export const PAGE_PRINT_DIALOG_CHANNEL = 'hronaut:page-print'

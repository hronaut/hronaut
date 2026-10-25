/** The white margin a scanner needs around a code, in modules, drawn around the code in the dialog. */
export const QR_CODE_QUIET_ZONE = 4

/** An SVG path of a QR code's dark modules, a module to a unit, as one rectangle for each run of dark modules in a row. */
export function qrCodePath(modules: readonly (readonly boolean[])[]): string {
  let path = ''
  modules.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (!row[x]) continue
      let end = x
      while (row[end + 1]) end++
      path += `M${x} ${y}h${end - x + 1}v1h${x - end - 1}z`
      x = end
    }
  })
  return path
}

import XLSX from 'xlsx-js-style'

/**
 * Shared look for every workbook we write. The mark colours deliberately match
 * the planning sheet the team already uses (green = done, yellow = in progress)
 * so an exported file drops straight back into their process.
 */
export const COLORS = {
  header: 'CCC0DA',
  headerText: '1A1C25',
  done: '00FF00',
  progress: 'FFFF00',
  testing: 'FFA63D',
  planned: 'D6DCF7',
  todo: 'E2E6F4',
  blocked: 'FFB3B9',
  total: 'EEF0F7',
  weekend: 'F1EFF7',
  line: 'B9BCC9'
}

const edge = { style: 'thin', color: { rgb: COLORS.line } }
export const BORDER = { top: edge, bottom: edge, left: edge, right: edge }

export const headerStyle = (fill = COLORS.header) => ({
  font: { bold: true, color: { rgb: COLORS.headerText } },
  fill: { fgColor: { rgb: fill } },
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  border: BORDER
})

export const cellStyle = (options = {}) => {
  const { fill, bold, align = 'left', numFmt, wrap } = options
  const style = { border: BORDER, alignment: { horizontal: align, vertical: 'top', wrapText: !!wrap } }
  if (fill) style.fill = { fgColor: { rgb: fill } }
  if (bold) style.font = { bold: true }
  if (numFmt) style.numFmt = numFmt
  return style
}

/** aoa_to_sheet leaves blanks undefined; styling them keeps the grid unbroken. */
export function styleSheet(sheet, styleFor) {
  const range = XLSX.utils.decode_range(sheet['!ref'])
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const address = XLSX.utils.encode_cell({ r, c })
      const style = styleFor(r, c)
      if (!style) continue
      if (!sheet[address]) sheet[address] = { t: 'z', v: undefined }
      sheet[address].s = style
    }
  }
  return sheet
}

export const setWidths = (sheet, widths) => {
  sheet['!cols'] = widths.map((wch) => ({ wch }))
  return sheet
}

// NOTE: freeze panes are deliberately not set — the community XLSX writer drops
// `!views`/`!freeze` silently, so the file would claim a formatting it lacks.

export const bookWith = (sheets) => {
  const wb = XLSX.utils.book_new()
  for (const { name, sheet } of sheets) XLSX.utils.book_append_sheet(wb, sheet, name)
  return wb
}

export { XLSX }

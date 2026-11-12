import { formatHM } from './parseWorkbook.js'
import { pivotToAoA } from './pivot.js'
import { clock, dayLabel, spansMidnight } from './timetable.js'
import { COLORS, XLSX, bookWith, cellStyle, headerStyle, setWidths, styleSheet } from './xlsxStyle.js'

const HOURS_FMT = '0.00'

/** Shades a cell by its share of the largest value, mirroring the on-screen heat. */
const heat = (value, max) => {
  if (!value || !max) return undefined
  const t = Math.min(1, value / max)
  const mix = (from, to) => Math.round(from + (to - from) * t)
  const rgb = [mix(238, 138), mix(241, 160), mix(247, 244)]
  return rgb.map((n) => n.toString(16).padStart(2, '0').toUpperCase()).join('')
}

export function buildPivotWorkbook(pivot, rowLabel, { measure }) {
  const numeric = measure === 'count' ? (v) => v : (v) => Math.round(v * 100) / 100
  const aoa = pivotToAoA(pivot, rowLabel, numeric)
  const sheet = XLSX.utils.aoa_to_sheet(aoa)
  const lastRow = aoa.length - 1
  const lastCol = aoa[0].length - 1
  const max = pivot.maxCell

  styleSheet(sheet, (r, c) => {
    if (r === 0) return headerStyle()
    const isTotalRow = r === lastRow
    const isTotalCol = c === lastCol
    if (c === 0) return cellStyle({ bold: isTotalRow, wrap: true })
    if (isTotalRow || isTotalCol) {
      return cellStyle({ align: 'right', bold: true, fill: COLORS.total, numFmt: measure === 'count' ? '0' : HOURS_FMT })
    }
    return cellStyle({
      align: 'right',
      numFmt: measure === 'count' ? '0' : HOURS_FMT,
      fill: measure === 'count' ? undefined : heat(pivot.rows[r - 1]?.values[c - 1], max)
    })
  })

  setWidths(sheet, [38, ...pivot.columns.map(() => 14), 12])
  return bookWith([{ name: 'Pivot', sheet }])
}

export function buildTimetableWorkbook(model, member) {
  const grid = [
    ['Task', ...model.dates, 'Total'],
    ...model.tasks.map((t) => [
      t.task,
      ...model.dates.map((d) => (t.days.has(d) ? Math.round(t.days.get(d).hours * 100) / 100 : null)),
      Math.round(t.total * 100) / 100
    ]),
    [
      'Day total',
      ...model.dayTotals.map((v) => Math.round(v * 100) / 100),
      Math.round(model.grand * 100) / 100
    ],
    [
      'Day span',
      ...model.firstLast.map((f) =>
        f ? `${clock(f.from)} - ${clock(f.to)}${f.toNextDay ? ' (+1d)' : ''}` : ''
      ),
      ''
    ]
  ]

  const sheet = XLSX.utils.aoa_to_sheet(grid)
  const weekend = model.dates.map((d) => dayLabel(d).weekend)
  const totalRow = grid.length - 2
  const spanRow = grid.length - 1
  const lastCol = grid[0].length - 1
  const maxCell = Math.max(
    0,
    ...model.tasks.flatMap((t) => [...t.days.values()].map((cell) => cell.hours))
  )

  styleSheet(sheet, (r, c) => {
    const isDay = c > 0 && c <= model.dates.length
    if (r === 0) return headerStyle(isDay && weekend[c - 1] ? COLORS.weekend : COLORS.header)
    if (c === 0) return cellStyle({ bold: r >= totalRow, wrap: true })
    if (r === spanRow) return cellStyle({ align: 'center', fill: COLORS.total })
    if (r === totalRow || c === lastCol) {
      return cellStyle({ align: 'right', bold: true, fill: COLORS.total, numFmt: HOURS_FMT })
    }
    const value = model.tasks[r - 1]?.days.get(model.dates[c - 1])?.hours
    return cellStyle({
      align: 'right',
      numFmt: HOURS_FMT,
      fill: heat(value, maxCell) || (weekend[c - 1] ? COLORS.weekend : undefined)
    })
  })

  setWidths(sheet, [34, ...model.dates.map(() => 12), 10])

  // One row per session, with the exact times the grid can only summarise.
  const detail = [['Date', 'Task', 'From', 'To', 'Hours', 'h:mm', 'Note']]
  for (const d of model.dates) {
    for (const t of model.tasks) {
      for (const e of t.days.get(d)?.items ?? []) {
        detail.push([
          d,
          t.task,
          clock(e.start),
          clock(e.end) + (spansMidnight(e) ? ' (+1d)' : ''),
          Math.round(e.hours * 100) / 100,
          formatHM(e.hours),
          e.note
        ])
      }
    }
  }
  const entriesSheet = XLSX.utils.aoa_to_sheet(detail)
  styleSheet(entriesSheet, (r, c) =>
    r === 0
      ? headerStyle()
      : cellStyle({ align: c === 4 ? 'right' : 'left', numFmt: c === 4 ? HOURS_FMT : undefined, wrap: c === 6 })
  )
  setWidths(entriesSheet, [12, 34, 12, 14, 9, 9, 46])

  return {
    workbook: bookWith([
      { name: 'Timetable', sheet },
      { name: 'Entries', sheet: entriesSheet }
    ]),
    fileName: `timetable-${member.replace(/[^\w]+/g, '-').toLowerCase()}.xlsx`
  }
}

export const ROW_FIELDS = [
  { id: 'task', label: 'Task' },
  { id: 'taskFull', label: 'Task (full label)' },
  { id: 'status', label: 'Status' },
  { id: 'billing', label: 'Billing' },
  { id: 'tags', label: 'Tag' },
  { id: 'date', label: 'Date' },
  { id: 'month', label: 'Month' },
  { id: 'member', label: 'Member' }
]

export const COL_FIELDS = ROW_FIELDS

export const MEASURES = [
  { id: 'hours', label: 'Hours' },
  { id: 'count', label: 'Entries' }
]

/**
 * Builds a rows x columns matrix of summed hours (or entry counts) with
 * margins, which is what the spreadsheet pivot produces for
 * task-by-person time.
 */
export function buildPivot(entries, { rowField, colField, measure = 'hours' }) {
  const cells = new Map() // rowKey -> Map(colKey -> {hours, count})
  const rowTotals = new Map()
  const colTotals = new Map()
  let grand = { hours: 0, count: 0 }

  const bump = (acc, e) => {
    acc.hours += e.hours
    acc.count += 1
    return acc
  }
  const blank = () => ({ hours: 0, count: 0 })

  for (const e of entries) {
    const r = e[rowField] ?? '(blank)'
    const c = e[colField] ?? '(blank)'
    if (!cells.has(r)) cells.set(r, new Map())
    const row = cells.get(r)
    if (!row.has(c)) row.set(c, blank())
    bump(row.get(c), e)
    if (!rowTotals.has(r)) rowTotals.set(r, blank())
    bump(rowTotals.get(r), e)
    if (!colTotals.has(c)) colTotals.set(c, blank())
    bump(colTotals.get(c), e)
    bump(grand, e)
  }

  const pick = (acc) => (acc ? acc[measure] : 0)

  const columns = [...colTotals.keys()].sort(
    (a, b) => pick(colTotals.get(b)) - pick(colTotals.get(a)) || a.localeCompare(b)
  )

  const rows = [...cells.keys()].map((r) => ({
    key: r,
    total: pick(rowTotals.get(r)),
    values: columns.map((c) => pick(cells.get(r).get(c)))
  }))

  return {
    rows,
    columns,
    columnTotals: columns.map((c) => pick(colTotals.get(c))),
    grandTotal: pick(grand),
    maxCell: rows.reduce((m, r) => Math.max(m, ...r.values), 0)
  }
}

export function sortPivot(pivot, { by, dir }) {
  const rows = [...pivot.rows]
  const sign = dir === 'asc' ? 1 : -1
  rows.sort((a, b) => {
    if (by === 'label') return sign * a.key.localeCompare(b.key)
    if (by === 'total') return sign * (a.total - b.total) || a.key.localeCompare(b.key)
    const i = pivot.columns.indexOf(by)
    if (i === -1) return 0
    return sign * (a.values[i] - b.values[i]) || a.key.localeCompare(b.key)
  })
  return { ...pivot, rows }
}

export function pivotToAoA(pivot, rowLabel, formatValue) {
  const header = [rowLabel, ...pivot.columns, 'Total']
  const body = pivot.rows.map((r) => [
    r.key,
    ...r.values.map((v) => formatValue(v)),
    formatValue(r.total)
  ])
  const footer = [
    'Grand Total',
    ...pivot.columnTotals.map((v) => formatValue(v)),
    formatValue(pivot.grandTotal)
  ]
  return [header, ...body, footer]
}

import XLSX from 'xlsx-js-style'

/**
 * The export has a title row ("(555) WACTO") above the real header, and the
 * header itself can shift if the export changes, so we locate the header row by
 * looking for the columns we actually need instead of assuming a fixed offset.
 */
const FIELDS = {
  member: ['member', 'user', 'name', 'employee'],
  task: ['task', 'project', 'activity'],
  tags: ['timesheet tags', 'tags', 'tag'],
  start: ['start time', 'start', 'from'],
  end: ['end time', 'end', 'to'],
  note: ['note', 'notes', 'description', 'comment'],
  duration: ['time (h)', 'time(h)', 'duration', 'time'],
  decimal: ['time (decimal)', 'time(decimal)', 'decimal', 'hours']
}

const norm = (v) => String(v ?? '').replace(/\s+/g, ' ').trim()
const key = (v) => norm(v).toLowerCase()

function findHeaderRow(rows) {
  for (let r = 0; r < Math.min(rows.length, 25); r++) {
    const cells = (rows[r] || []).map(key)
    const hasMember = cells.some((c) => FIELDS.member.includes(c))
    const hasTask = cells.some((c) => FIELDS.task.includes(c))
    if (hasMember && hasTask) return r
  }
  return -1
}

function mapColumns(headerCells) {
  const map = {}
  headerCells.forEach((cell, i) => {
    const k = key(cell)
    if (!k) return
    for (const [field, aliases] of Object.entries(FIELDS)) {
      if (map[field] === undefined && aliases.includes(k)) map[field] = i
    }
  })
  return map
}

/**
 * Durations arrive in three shapes: "04:31" text, a plain decimal (4.52), or —
 * when the cell is time-formatted — an Excel day fraction that xlsx hands back
 * as a number or as a 1899-epoch Date. `mode` says how to read a bare number:
 * 'decimal' columns are already hours, 'clock' columns are fractions of a day.
 */
const EXCEL_EPOCH = new Date(1899, 11, 30)

function parseDuration(value, mode = 'decimal') {
  if (value == null || value === '') return null

  if (value instanceof Date) {
    if (isNaN(value) || value.getFullYear() > 1910) return null
    return (value - EXCEL_EPOCH) / 3600000
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    return mode === 'clock' ? value * 24 : value
  }

  const s = norm(value)
  const hms = s.match(/^(\d+):([0-5]?\d)(?::([0-5]?\d))?$/)
  if (hms) {
    return Number(hms[1]) + Number(hms[2]) / 60 + Number(hms[3] || 0) / 3600
  }
  const num = Number(s.replace(',', '.'))
  return Number.isFinite(num) ? num : null
}

/** Accepts real Date cells, Excel serials, and "30-08-2026 2:00 PM" strings. */
function parseDateTime(value) {
  if (value == null || value === '') return null
  if (value instanceof Date && !isNaN(value)) return value
  if (typeof value === 'number') {
    const d = XLSX.SSF.parse_date_code(value)
    if (!d) return null
    return new Date(d.y, d.m - 1, d.d, d.H, d.M, Math.floor(d.S))
  }
  const s = norm(value)
  const m = s.match(
    /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/
  )
  if (m) {
    let [, d, mo, y, hh = '0', mi = '0', ss = '0', ampm] = m
    let year = Number(y)
    if (year < 100) year += 2000
    let hour = Number(hh)
    if (ampm) {
      const pm = ampm.toLowerCase() === 'pm'
      if (pm && hour < 12) hour += 12
      if (!pm && hour === 12) hour = 0
    }
    return new Date(year, Number(mo) - 1, Number(d), hour, Number(mi), Number(ss))
  }
  const fallback = new Date(s)
  return isNaN(fallback) ? null : fallback
}

/**
 * Task cells look like "Multicurrency impl -  Not Billed - In Progress".
 * The trailing " - <billing> - <status>" is metadata, so split it off to keep
 * pivot rows readable while preserving the original label.
 */
function splitTask(raw) {
  const full = norm(raw)
  const parts = full.split(/\s+-\s+/).map(norm).filter(Boolean)
  let name = full
  let billing = ''
  let status = ''
  if (parts.length >= 3) {
    status = parts[parts.length - 1]
    billing = parts[parts.length - 2]
    name = parts.slice(0, -2).join(' - ')
  }
  const billed = /not billed/i.test(billing) ? 'Not Billed' : billing ? 'Billed' : ''
  return { full, name: name || full, billing: billed || billing, status }
}

const pad = (n) => String(n).padStart(2, '0')
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/**
 * Members type the same task with different casing ("Test server issue" vs
 * "test server issue"). A spreadsheet pivot folds those into one row, so pick
 * the most common spelling of each label and use it everywhere.
 */
function canonicalizeLabels(entries, field) {
  const variants = new Map()
  for (const e of entries) {
    const k = e[field].toLowerCase()
    if (!variants.has(k)) variants.set(k, new Map())
    const counts = variants.get(k)
    counts.set(e[field], (counts.get(e[field]) || 0) + 1)
  }
  const winner = new Map()
  for (const [k, counts] of variants) {
    winner.set(k, [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0])
  }
  for (const e of entries) e[field] = winner.get(e[field].toLowerCase())
}

export function parseWorkbook(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { cellDates: true })
  const sheets = []

  for (const sheetName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
      header: 1,
      raw: true,
      blankrows: false,
      defval: null
    })
    const headerRow = findHeaderRow(rows)
    if (headerRow === -1) continue

    const cols = mapColumns(rows[headerRow])
    const entries = []
    let skipped = 0

    for (let r = headerRow + 1; r < rows.length; r++) {
      const row = rows[r] || []
      const member = norm(row[cols.member])
      const rawTask = row[cols.task]
      if (!member && !norm(rawTask)) continue

      const start = parseDateTime(row[cols.start])
      const end = parseDateTime(row[cols.end])

      let hours = parseDuration(cols.decimal !== undefined ? row[cols.decimal] : null, 'decimal')
      if (hours == null)
        hours = parseDuration(cols.duration !== undefined ? row[cols.duration] : null, 'clock')
      if (hours == null && start && end) hours = (end - start) / 3600000
      if (hours == null || !Number.isFinite(hours)) {
        skipped++
        continue
      }

      const task = splitTask(rawTask)
      entries.push({
        id: `${sheetName}:${r}`,
        member: member || '(no member)',
        task: task.name || '(no task)',
        taskFull: task.full || '(no task)',
        billing: task.billing || '(none)',
        status: task.status || '(none)',
        tags: norm(cols.tags !== undefined ? row[cols.tags] : '') || '(untagged)',
        note: norm(cols.note !== undefined ? row[cols.note] : ''),
        start,
        end,
        date: start ? isoDate(start) : '(no date)',
        month: start ? `${start.getFullYear()}-${pad(start.getMonth() + 1)}` : '(no date)',
        hours: Math.round(hours * 10000) / 10000
      })
    }

    if (entries.length) sheets.push({ sheetName, entries, skipped })
  }

  if (!sheets.length) {
    throw new Error(
      'No timesheet rows found. The sheet needs a header row containing at least "Member" and "Task".'
    )
  }

  const entries = sheets.flatMap((s) => s.entries)
  for (const field of ['task', 'taskFull', 'tags', 'status']) canonicalizeLabels(entries, field)

  return {
    entries,
    skipped: sheets.reduce((a, s) => a + s.skipped, 0),
    sheetNames: sheets.map((s) => s.sheetName)
  }
}

export const formatHM = (hours) => {
  const total = Math.round((hours || 0) * 60)
  const sign = total < 0 ? '-' : ''
  const abs = Math.abs(total)
  return `${sign}${Math.floor(abs / 60)}:${pad(abs % 60)}`
}

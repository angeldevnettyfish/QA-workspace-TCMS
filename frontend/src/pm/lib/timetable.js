const pad = (n) => String(n).padStart(2, '0')

export const clock = (d) =>
  d
    ? `${((d.getHours() + 11) % 12) + 1}:${pad(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}`
    : '—'

/** Late sessions run past midnight but still belong to the day they started on. */
export const spansMidnight = (e) =>
  !!(e.start && e.end && e.end.toDateString() !== e.start.toDateString())

export const dayLabel = (iso) => {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const month = date.toLocaleDateString(undefined, { month: 'short' })
  return {
    weekday: date.toLocaleDateString(undefined, { weekday: 'short' }),
    dayNum: pad(d),
    month,
    day: `${pad(d)} ${month}`,
    weekend: date.getDay() === 0 || date.getDay() === 6
  }
}

/**
 * One person's entries as a task x date grid: each cell carries the day's total
 * for that task plus the individual sessions, so the view can show both the
 * hours and the exact from-to times behind them.
 */
export function buildTimetable(entries, member) {
  const mine = entries.filter((e) => e.member === member)
  const dates = [...new Set(mine.map((e) => e.date))].sort()
  const byTask = new Map()

  for (const e of mine) {
    if (!byTask.has(e.task)) byTask.set(e.task, { total: 0, days: new Map() })
    const row = byTask.get(e.task)
    row.total += e.hours
    if (!row.days.has(e.date)) row.days.set(e.date, { hours: 0, items: [] })
    const cell = row.days.get(e.date)
    cell.hours += e.hours
    cell.items.push(e)
  }

  for (const row of byTask.values()) {
    for (const cell of row.days.values()) {
      cell.items.sort((a, b) => (a.start?.getTime() ?? 0) - (b.start?.getTime() ?? 0))
    }
  }

  const tasks = [...byTask.entries()]
    .map(([task, row]) => ({ task, ...row }))
    .sort((a, b) => b.total - a.total || a.task.localeCompare(b.task))

  const dayTotals = dates.map((d) => mine.reduce((a, e) => (e.date === d ? a + e.hours : a), 0))

  const firstLast = dates.map((d) => {
    const day = mine.filter((e) => e.date === d && e.start)
    if (!day.length) return null
    const starts = day.map((e) => e.start.getTime())
    const ends = day.filter((e) => e.end).map((e) => e.end.getTime())
    const from = new Date(Math.min(...starts))
    const to = ends.length ? new Date(Math.max(...ends)) : null
    return { from, to, toNextDay: !!to && to.toDateString() !== from.toDateString() }
  })

  return {
    tasks,
    dates,
    dayTotals,
    firstLast,
    grand: mine.reduce((a, e) => a + e.hours, 0),
    entryCount: mine.length
  }
}

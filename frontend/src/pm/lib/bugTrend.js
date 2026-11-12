import { sprintLabel } from './scrum'

/**
 * Bugs entered per sprint, oldest to newest: the sum of every task's "issues
 * entered" in that sprint, with the task completion for the same sprint so the
 * two can be read side by side. The tasks with no sprint are left out; they
 * are not a point in time.
 */
export function bugTrend(people, sprints, limit = 8) {
  const ordered = [...sprints].sort((a, b) => (a.start || '').localeCompare(b.start || ''))
  const rows = ordered.map((sprint) => {
    const tasks = people.flatMap((person) => person.tasks.filter((t) => t.sprintId === sprint.id))
    const done = tasks.filter((t) => t.status === 'Done').length
    return {
      id: sprint.id,
      name: sprintLabel(sprint, sprints.indexOf(sprint)),
      bugs: tasks.reduce((n, t) => n + (t.issues || 0), 0),
      testCases: tasks.reduce((n, t) => n + (t.testCases || 0), 0),
      automated: tasks.reduce((n, t) => n + (t.automatedCases || 0), 0),
      tasks: tasks.length,
      done,
      completion: tasks.length ? Math.round((done / tasks.length) * 100) : 0
    }
  })
  return rows.slice(-limit)
}

/**
 * Positions for a line chart with one or more series: x spread evenly, y scaled
 * to the largest value of any series. `points` is the first series, which keeps
 * the single-line callers simple.
 */
export function chartPoints(trend, width, height, keys = ['bugs'], pad = { left: 44, right: 24, top: 26, bottom: 40 }) {
  const max = Math.max(1, ...trend.flatMap((r) => keys.map((k) => r[k] || 0)))
  // A tidy top of the axis: 1, 2, 5, 10, 20, 50 …
  const step = max <= 5 ? 1 : max <= 10 ? 2 : max <= 25 ? 5 : max <= 50 ? 10 : Math.ceil(max / 5 / 10) * 10
  const top = Math.ceil(max / step) * step
  const innerW = width - pad.left - pad.right
  const innerH = height - pad.top - pad.bottom
  const x = (i) => pad.left + (trend.length === 1 ? innerW / 2 : (innerW * i) / (trend.length - 1))
  const y = (v) => pad.top + innerH - (innerH * v) / top
  const ticks = []
  for (let v = 0; v <= top; v += step) ticks.push({ value: v, y: y(v) })
  const series = Object.fromEntries(
    keys.map((key) => [key, trend.map((r, i) => ({ ...r, value: r[key] || 0, x: x(i), y: y(r[key] || 0) }))])
  )
  return { pad, top, ticks, series, points: series[keys[0]].map((p) => ({ ...p, bugs: p.value })), baseline: y(0) }
}

const shorten = (text, n = 14) => (text.length > n ? `${text.slice(0, n - 1)}…` : text)

/**
 * The same chart as a PNG data URL, for the email: mail apps strip SVG and
 * scripts, but they show an attached image. Drawn at twice the size so it
 * stays sharp on high-density screens.
 */
export function renderBugChartPng(trend, { width = 640, height = 260 } = {}) {
  if (!trend.length || typeof document === 'undefined') return ''
  const scale = 2
  const canvas = document.createElement('canvas')
  canvas.width = width * scale
  canvas.height = height * scale
  const g = canvas.getContext('2d')
  g.scale(scale, scale)
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, width, height)
  const geo = chartPoints(trend, width, height)

  g.font = '12px Segoe UI, Arial, sans-serif'
  g.textBaseline = 'middle'
  for (const tick of geo.ticks) {
    g.strokeStyle = '#e5e7eb'
    g.lineWidth = 1
    g.beginPath()
    g.moveTo(geo.pad.left, tick.y)
    g.lineTo(width - geo.pad.right, tick.y)
    g.stroke()
    g.fillStyle = '#6b7280'
    g.textAlign = 'right'
    g.fillText(String(tick.value), geo.pad.left - 8, tick.y)
  }
  g.strokeStyle = '#dc2626'
  g.lineWidth = 2.5
  g.lineJoin = 'round'
  g.beginPath()
  geo.points.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)))
  g.stroke()
  for (const p of geo.points) {
    g.fillStyle = '#ffffff'
    g.strokeStyle = '#dc2626'
    g.lineWidth = 2.5
    g.beginPath()
    g.arc(p.x, p.y, 4.5, 0, Math.PI * 2)
    g.fill()
    g.stroke()
    g.fillStyle = '#111827'
    g.font = 'bold 12px Segoe UI, Arial, sans-serif'
    g.textAlign = 'center'
    g.fillText(String(p.bugs), p.x, p.y - 14)
    g.fillStyle = '#6b7280'
    g.font = '12px Segoe UI, Arial, sans-serif'
    g.fillText(shorten(p.name), p.x, height - geo.pad.bottom + 20)
  }
  return canvas.toDataURL('image/png')
}

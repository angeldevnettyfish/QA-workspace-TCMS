import { bugTrend } from './bugTrend'
import { formatDay, isCurrentSprint, sprintLabel, sprintRange, spentHours, todayISO } from './scrum'

/** Longest mailto: link most mail apps accept; the body is cut to fit. */
export const MAILTO_LIMIT = 1800

const esc = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const round = (n) => Math.round((n || 0) * 100) / 100
const hoursText = (n) => (n > 0 ? `${round(n)} h` : '')

export const isValidEmail = (value) => /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/.test(String(value ?? '').trim())

/** Splits "a@x.com, b@y.com; c@z.com" into clean, distinct addresses. */
export function parseAddresses(text) {
  const seen = new Set()
  return String(text ?? '')
    .split(/[\s,;]+/)
    .map((a) => a.trim())
    .filter((a) => {
      const key = a.toLowerCase()
      if (!a || seen.has(key)) return false
      seen.add(key)
      return true
    })
}

/**
 * Which sprint just finished and which one comes next. While a sprint is
 * running it is the "next" one (this is the plan for it) and the sprint before
 * it is the one being reviewed; with none running, the last one that ended is
 * reviewed and the first one still to start is planned.
 */
export function defaultReviewPair(sprints, on = todayISO()) {
  const ordered = [...sprints].sort((a, b) => (a.start || '').localeCompare(b.start || ''))
  const current = ordered.find((s) => isCurrentSprint(s, on))
  if (current) {
    const at = ordered.indexOf(current)
    return { previous: ordered[at - 1] || null, next: current }
  }
  const ended = ordered.filter((s) => s.end && s.end < on)
  const upcoming = ordered.filter((s) => s.start && s.start > on)
  return { previous: ended[ended.length - 1] || null, next: upcoming[0] || null }
}

/** Tasks of one sprint, grouped by the person who holds them. */
function byPerson(people, sprintId, keep = () => true) {
  return people
    .map((person) => ({
      person,
      tasks: person.tasks.filter((t) => t.sprintId === sprintId && keep(t))
    }))
    .filter((group) => group.tasks.length)
}

export function planningSummary({ people, previous, next, sprints, signature = '', date = todayISO() }) {
  const label = (s) => (s ? sprintLabel(s, sprints.indexOf(s)) : '')
  const prevName = label(previous)
  const nextName = label(next)

  const done = previous ? byPerson(people, previous.id, (t) => t.status === 'Done') : []
  const open = previous ? byPerson(people, previous.id, (t) => t.status !== 'Done') : []
  const planned = next ? byPerson(people, next.id) : []

  const count = (groups) => groups.reduce((n, g) => n + g.tasks.length, 0)
  const sum = (groups, pick) => groups.reduce((n, g) => n + g.tasks.reduce((m, t) => m + pick(t), 0), 0)
  const doneHours = sum(done, (t) => spentHours(t))
  const plannedHours = sum(planned, (t) => t.estimate || 0)

  const prevTotal = count(done) + count(open)
  const trend = bugTrend(people, sprints)
  const prevBugs = previous ? (trend.find((r) => r.id === previous.id)?.bugs ?? 0) : 0
  const completion = prevTotal ? Math.round((count(done) / prevTotal) * 100) : 0

  const subject = `Sprint planning summary${prevName ? ` — ${prevName} done` : ''}${nextName ? `, ${nextName} planned` : ''}`

  // ---- plain text
  const lines = ['Hello everyone,', '']
  if (previous) {
    lines.push(
      `Task completion${prevName ? ` (${prevName})` : ''}: ${completion}% — ${count(done)} of ${prevTotal} task(s) done${doneHours ? `, ${round(doneHours)} h spent` : ''}`,
      ''
    )
  }
  if (trend.length) {
    lines.push(`Bugs entered per sprint: ${trend.map((r) => `${r.name} ${r.bugs}`).join(' → ')}`, '')
  }
  if (previous) {
    lines.push(`Tasks done in ${prevName} (${sprintRange(previous)}):`)
    if (done.length) {
      for (const g of done) {
        for (const t of g.tasks) {
          const h = hoursText(spentHours(t))
          lines.push(`  [x] ${t.title.trim() || 'untitled'} (${g.person.name.trim() || 'unassigned'})${h ? ` — ${h}` : ''}`)
        }
      }
      lines.push(`  ${count(done)} task(s) done${doneHours ? `, ${round(doneHours)} h spent` : ''}.`)
    } else lines.push('  Nothing was marked done.')
    if (open.length) {
      lines.push('', `Not finished in ${prevName}:`)
      for (const g of open)
        for (const t of g.tasks)
          lines.push(`  [ ] ${t.title.trim() || 'untitled'} (${g.person.name.trim() || 'unassigned'}) — ${t.status}`)
    }
    lines.push('')
  }
  if (next) {
    lines.push(`Planned for ${nextName} (${sprintRange(next)}):`)
    if (planned.length) {
      for (const g of planned) {
        const personHours = g.tasks.reduce((n, task) => n + (task.estimate || 0), 0)
        lines.push(`  ${g.person.name.trim() || 'Unassigned'} (${round(personHours)} h):`)
        for (const t of g.tasks) {
          const h = hoursText(t.estimate)
          lines.push(`    - ${t.title.trim() || 'untitled'}${h ? ` — ${h}` : ''}`)
        }
      }
      lines.push(`  ${count(planned)} task(s) planned${plannedHours ? `, ${round(plannedHours)} h estimated` : ''}.`)
    } else lines.push('  Nothing is planned yet.')
    lines.push('')
  }
  lines.push('Thanks,', signature.trim() || '')
  const text = lines.join('\n').trim()

  // ---- formatted
  const li = (inner) => `<li style="margin:2px 0">${inner}</li>`
  const muted = (s) => `<span style="color:#6b7280">${esc(s)}</span>`
  let html = '<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.5;color:#111827">'
  html += '<p>Hello everyone,</p>'
  if (previous) {
    const barColor = completion >= 80 ? '#16a34a' : completion >= 50 ? '#d97706' : '#dc2626'
    const tile = (value, label, color = '#111827') =>
      `<td style="padding:10px 18px;border:1px solid #e5e7eb;border-radius:8px;text-align:center;background:#f9fafb"><div style="font-size:24px;font-weight:700;color:${color}">${value}</div><div style="font-size:12px;color:#6b7280">${esc(label)}</div></td>`
    html += '<table role="presentation" cellspacing="8" cellpadding="0" style="margin:6px 0 2px -8px;border-collapse:separate"><tr>'
    html += tile(`${completion}%`, `task completion · ${prevName}`, barColor)
    html += tile(`${count(done)} / ${prevTotal}`, 'tasks done')
    html += tile(`${prevBugs}`, `bugs entered · ${prevName}`, prevBugs ? '#dc2626' : '#111827')
    if (next) html += tile(`${count(planned)}`, `planned for ${nextName}`)
    html += '</tr></table>'
    html += `<div style="height:8px;width:340px;max-width:100%;background:#e5e7eb;border-radius:4px;margin:2px 0 10px"><div style="height:8px;width:${completion}%;background:${barColor};border-radius:4px"></div></div>`
  }
  if (trend.length) {
    html += '<p style="margin:12px 0 4px"><b>Bugs entered per sprint</b></p>'
    html += '<img src="cid:bugtrend" alt="Line chart of bugs entered per sprint" width="640" style="max-width:100%;height:auto;border:1px solid #e5e7eb;border-radius:8px"/>'
  }

  if (previous) {
    html += `<p>Below are the tasks done during <b>${esc(prevName)}</b> ${muted(`(${sprintRange(previous)})`)}:</p>`
    if (done.length) {
      html += '<ul style="padding-left:20px;margin:6px 0">'
      for (const g of done)
        for (const t of g.tasks) {
          const h = hoursText(spentHours(t))
          html += li(`✅ ${esc(t.title.trim() || 'untitled')} ${muted(`(${g.person.name.trim() || 'unassigned'})`)}${h ? ` ${muted('· ' + h)}` : ''}`)
        }
      html += '</ul>'
      html += `<p style="margin:4px 0">${muted(`${count(done)} task(s) done${doneHours ? `, ${round(doneHours)} h spent` : ''}.`)}</p>`
    } else html += `<p>${muted('Nothing was marked done.')}</p>`
    if (open.length) {
      html += `<p>Not finished in <b>${esc(prevName)}</b>:</p><ul style="padding-left:20px;margin:6px 0">`
      for (const g of open)
        for (const t of g.tasks)
          html += li(`⬜ ${esc(t.title.trim() || 'untitled')} ${muted(`(${g.person.name.trim() || 'unassigned'}) · ${t.status}`)}`)
      html += '</ul>'
    }
  }
  if (next) {
    html += `<p style="margin-top:16px">Planned for <b>${esc(nextName)}</b> ${muted(`(${sprintRange(next)})`)}:</p>`
    if (planned.length) {
      for (const g of planned) {
        const personHours = g.tasks.reduce((n, task) => n + (task.estimate || 0), 0)
        html += `<p style="margin:8px 0 2px"><b>${esc(g.person.name.trim() || 'Unassigned')}</b> ${muted(`(${round(personHours)} h)`)}</p><ul style="padding-left:20px;margin:2px 0">`
        for (const t of g.tasks) {
          const h = hoursText(t.estimate)
          html += li(`${esc(t.title.trim() || 'untitled')}${h ? ` ${muted('· ' + h)}` : ''}`)
        }
        html += '</ul>'
      }
      html += `<p style="margin:4px 0">${muted(`${count(planned)} task(s) planned${plannedHours ? `, ${round(plannedHours)} h estimated` : ''}.`)}</p>`
    } else html += `<p>${muted('Nothing is planned yet.')}</p>`
  }
  html += `<p style="margin-top:16px">Thanks,<br/>${esc(signature.trim())}</p></div>`

  return {
    subject,
    text,
    html,
    trend,
    counts: { completion, done: count(done), open: count(open), planned: count(planned), doneHours: round(doneHours), plannedHours: round(plannedHours) },
    date
  }
}

export function mailtoUrl({ to = [], subject = '', body = '' } = {}) {
  const head = `mailto:${to.map(encodeURIComponent).join(',')}?subject=${encodeURIComponent(subject)}&body=`
  let text = body
  while (text.length > 0 && (head + encodeURIComponent(text)).length > MAILTO_LIMIT) {
    text = text.slice(0, Math.floor(text.length * 0.9))
  }
  const cut = text.length < body.length
  return head + encodeURIComponent(cut ? `${text}\n…` : text)
}

/** Puts the formatted version on the clipboard so it pastes into a mail with its bullets. */
export async function copyRich(html, text) {
  if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' })
      })
    ])
    return
  }
  await navigator.clipboard.writeText(text)
}

/**
 * The testers' notes for one day: each person's daily note, then the tasks they
 * are on with the notes written against them. `sprint` narrows the tasks (null
 * means everything); people with nothing to report are left out.
 */
export function standupSummary({ people, sprintId = null, sprintName = '', day, signature = '' }) {
  const inScope = (t) => sprintId === null || t.sprintId === sprintId
  const rows = people
    .map((person) => ({
      person,
      note: (person.log || []).find((n) => n.date === day)?.text?.trim() || '',
      tasks: person.tasks.filter((t) => inScope(t) && t.status !== 'Done')
    }))
    .filter((r) => r.note || r.tasks.length)
  const when = formatDay(day, { weekday: true })
  const subject = `Daily standup notes — ${when}${sprintName ? ` · ${sprintName}` : ''}`

  const name = (p) => p.name.trim() || 'Unassigned'
  const lines = ['Hello everyone,', '', `Here are the testers' notes for ${when}${sprintName ? ` (${sprintName})` : ''}:`, '']
  let html = '<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.5;color:#111827">'
  html += `<p>Hello everyone,</p><p>Here are the testers' notes for <b>${esc(when)}</b>${sprintName ? ` <span style="color:#6b7280">(${esc(sprintName)})</span>` : ''}:</p>`
  if (!rows.length) {
    lines.push('No notes or open tasks.')
    html += '<p style="color:#6b7280">No notes or open tasks.</p>'
  }
  for (const { person, note, tasks } of rows) {
    lines.push(name(person))
    html += `<p style="margin:14px 0 2px"><b>${esc(name(person))}</b></p>`
    lines.push(note ? `  Note: ${note.replace(/\n/g, '\n        ')}` : '  Note: —')
    html += `<p style="margin:2px 0">${note ? esc(note).replace(/\n/g, '<br/>') : '<span style="color:#6b7280">No note for this day.</span>'}</p>`
    if (tasks.length) {
      html += '<ul style="padding-left:20px;margin:4px 0">'
      for (const t of tasks) {
        const detail = t.notes.trim()
        lines.push(`  - [${t.status}] ${t.title.trim() || 'untitled'}${detail ? ` — ${detail.replace(/\n/g, ' ')}` : ''}`)
        html += `<li style="margin:2px 0">${esc(t.title.trim() || 'untitled')} <span style="color:#6b7280">· ${esc(t.status)}</span>${detail ? `<br/><span style="color:#374151">${esc(detail).replace(/\n/g, '<br/>')}</span>` : ''}</li>`
      }
      html += '</ul>'
    }
    lines.push('')
  }
  lines.push('Thanks,', signature.trim() || '')
  html += `<p style="margin-top:16px">Thanks,<br/>${esc(signature.trim())}</p></div>`
  return { subject, text: lines.join('\n').trim(), html, counts: { people: rows.length, notes: rows.filter((r) => r.note).length } }
}

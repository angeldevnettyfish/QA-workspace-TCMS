import React from 'react'
import TabStats from '../components/TabStats'
import { useCallback, useMemo, useState } from 'react'
import PivotTable from '../components/PivotTable'
import MemberDetail from '../components/MemberDetail'
import TaskDialog from '../components/TaskDialog'
import { formatHM } from '../lib/parseWorkbook'
import { buildPivot, sortPivot, ROW_FIELDS, COL_FIELDS, MEASURES } from '../lib/pivot'
import { buildPivotWorkbook } from '../lib/exportSpentTime'
import { XLSX } from '../lib/xlsxStyle'
import { entryHours, sprintLabel, hours as toHours } from '../lib/scrum'
import { useScrum } from '../lib/scrumState'

const emptyFilters = { members: new Set(), from: '', to: '', query: '' }
const pad = (n) => String(n).padStart(2, '0')
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const monthStart = () => {
  const d = new Date()
  return isoDate(new Date(d.getFullYear(), d.getMonth(), 1))
}

/**
 * Every stretch of time logged on the board, as timesheet rows: one per time
 * entry, plus one for a task whose hours were only typed in. `taskId` lets a
 * row open the task it belongs to.
 */
function boardEntries(people, sprints) {
  const out = []
  const now = Date.now()
  for (const person of people) {
    for (const task of person.tasks) {
      const sprint = sprints.find((s) => s.id === task.sprintId)
      const base = {
        taskId: task.id,
        member: person.name.trim() || '(no member)',
        task: task.title.trim() || '(no task)',
        taskFull: task.title.trim() || '(no task)',
        billing: '(none)',
        status: task.status,
        tags: sprint ? sprintLabel(sprint, sprints.indexOf(sprint)) : 'Backlog'
      }
      if (task.entries.length) {
        for (const entry of task.entries) {
          const start = entry.start ? new Date(entry.start) : null
          if (!start || Number.isNaN(start.getTime())) continue
          const hours = entryHours(entry, now)
          out.push({
            ...base,
            id: `${task.id}:${entry.id}`,
            note: entry.note || '',
            start,
            end: entry.end ? new Date(entry.end) : new Date(now),
            date: isoDate(start),
            month: `${start.getFullYear()}-${pad(start.getMonth() + 1)}`,
            hours
          })
        }
      } else if (toHours(task.spent) > 0) {
        const when = task.updatedAt ? new Date(task.updatedAt) : new Date()
        const start = new Date(when.getFullYear(), when.getMonth(), when.getDate(), 9, 0, 0)
        out.push({
          ...base,
          id: `${task.id}:manual`,
          note: 'Total typed on the task',
          start,
          end: new Date(start.getTime() + toHours(task.spent) * 3600000),
          date: isoDate(start),
          month: `${start.getFullYear()}-${pad(start.getMonth() + 1)}`,
          hours: toHours(task.spent)
        })
      }
    }
  }
  return out
}

export default function SpentTime() {
  const { people, sprints, reload, store } = useScrum()
  const [error, setError] = useState('')
  const [range, setRange] = useState(() => ({ from: monthStart(), to: isoDate(new Date()) }))
  const [reloading, setReloading] = useState(false)
  const [openTaskId, setOpenTaskId] = useState(null)

  const [rowField, setRowField] = useState('task')
  const [colField, setColField] = useState('member')
  const [measure, setMeasure] = useState('hours')
  const [asHM, setAsHM] = useState(false)
  const [sort, setSort] = useState({ by: 'total', dir: 'desc' })
  const [filters, setFilters] = useState(emptyFilters)
  const [detailMember, setDetailMember] = useState(null)

  const board = useMemo(() => boardEntries(people, sprints), [people, sprints])
  // Everything logged on the board, narrowed to the From/To range.
  const source = useMemo(
    () =>
      board.filter(
        (e) => (!range.from || e.date >= range.from) && (!range.to || e.date <= range.to)
      ),
    [board, range]
  )
  const taskIdFor = useMemo(() => new Map(board.map((e) => [e.task, e.taskId])), [board])

  const doReload = async () => {
    setReloading(true)
    setError('')
    try {
      await reload()
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setReloading(false)
    }
  }

  const facets = useMemo(() => {
    const dates = source.map((e) => e.date).filter((d) => d !== '(no date)').sort()
    return {
      members: [...new Set(source.map((e) => e.member))].sort(),
      minDate: dates[0] ?? '',
      maxDate: dates[dates.length - 1] ?? ''
    }
  }, [source])

  // The detail view needs the date and search filters applied but must still
  // show a member the chips have hidden.
  const filteredExceptMember = useMemo(() => {
    const q = filters.query.trim().toLowerCase()
    return source.filter((e) => {
      if (filters.from && e.date < filters.from) return false
      if (filters.to && e.date > filters.to) return false
      if (q && !`${e.taskFull} ${e.note} ${e.tags}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [source, filters])

  const filtered = useMemo(
    () => filteredExceptMember.filter((e) => !filters.members.size || filters.members.has(e.member)),
    [filteredExceptMember, filters.members]
  )

  const selectedMembers = useMemo(
    () => facets.members.filter((m) => !filters.members.size || filters.members.has(m)),
    [facets.members, filters.members]
  )

  const pivot = useMemo(
    () => sortPivot(buildPivot(filtered, { rowField, colField, measure }), sort),
    [filtered, rowField, colField, measure, sort]
  )

  const format = useCallback(
    (v) => (measure === 'count' ? String(v) : asHM ? formatHM(v) : (Math.round(v * 100) / 100).toFixed(2)),
    [measure, asHM]
  )

  const rowLabel = ROW_FIELDS.find((f) => f.id === rowField)?.label ?? rowField

  const onSort = (by) =>
    setSort((s) =>
      s.by === by ? { by, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { by, dir: by === 'label' ? 'asc' : 'desc' }
    )

  const exportPivot = (type) => {
    const wb = buildPivotWorkbook(pivot, rowLabel, { measure })
    const base = `pivot-${rowField}-by-${colField}`
    XLSX.writeFile(wb, type === 'csv' ? `${base}.csv` : `${base}.xlsx`)
  }

  const totalHours = filtered.reduce((a, e) => a + e.hours, 0)
  const canOpenTasks = (rowField === 'task' || rowField === 'taskFull')

  return (
    <>
      <TabStats id="spent-time">
        <div className="stats">
          <div>
            <span>{filtered.length}</span>
            <small>entries</small>
          </div>
          <div>
            <span>{(Math.round(totalHours * 100) / 100).toFixed(2)}</span>
            <small>hours ({formatHM(totalHours)})</small>
          </div>
          <div>
            <span>{facets.members.length}</span>
            <small>members</small>
          </div>
        </div>

      </TabStats>

      {error && <p className="error">{error}</p>}

      <section className="st-bar" aria-label="Spent time filters and pivot">
        <label>
          From
          <input type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
        </label>
        <label>
          To
          <input type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
        </label>
        <button
          type="button"
          className="primary"
          onClick={doReload}
          disabled={reloading}
          title="Time logged on the board loads on its own. Reload re-reads it from the server."
        >
          ↻ {reloading ? 'Loading…' : 'Reload'}
        </button>
        <span className="st-sep" aria-hidden="true" />
        <label>
          Rows
          <select value={rowField} onChange={(e) => setRowField(e.target.value)}>
            {ROW_FIELDS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Columns
          <select value={colField} onChange={(e) => setColField(e.target.value)}>
            {COL_FIELDS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Values
          <select value={measure} onChange={(e) => setMeasure(e.target.value)}>
            {MEASURES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        {measure === 'hours' && (
          <label className="st-check">
            <input type="checkbox" checked={asHM} onChange={(e) => setAsHM(e.target.checked)} />
            h:mm
          </label>
        )}
        <span className="st-sep" aria-hidden="true" />
        <div className="st-field">
          <span>Members</span>
          <details className="st-members">
            <summary>
              {filters.members.size && filters.members.size < facets.members.length
                ? `${filters.members.size} of ${facets.members.length}`
                : 'All'}{' '}
              ▾
            </summary>
            <div className="st-members-panel">
              <button
                type="button"
                className="link"
                onClick={() =>
                  setFilters((f) => ({
                    ...f,
                    members: f.members.size === facets.members.length ? new Set() : new Set(facets.members)
                  }))
                }
              >
                {filters.members.size === facets.members.length ? 'Clear' : 'Select all'}
              </button>
              {facets.members.map((m) => (
                <label key={m} className="st-member">
                  <input
                    type="checkbox"
                    checked={!filters.members.size || filters.members.has(m)}
                    onChange={() =>
                      setFilters((f) => {
                        const base = f.members.size ? new Set(f.members) : new Set(facets.members)
                        base.has(m) ? base.delete(m) : base.add(m)
                        return { ...f, members: base.size === facets.members.length ? new Set() : base }
                      })
                    }
                  />
                  {m}
                </label>
              ))}
            </div>
          </details>
        </div>
        <label className="st-search">
          Search
          <input
            type="search"
            value={filters.query}
            placeholder="search…"
            onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
          />
        </label>
        <span className="st-spacer" />
        <button
          type="button"
          className="primary"
          disabled={!selectedMembers.length}
          title={
            selectedMembers.length === 1
              ? `Day-by-day timetable for ${selectedMembers[0]}`
              : 'Day-by-day timetable — opens on the first selected member'
          }
          onClick={() => setDetailMember(selectedMembers[0])}
        >
          Details
        </button>
        <button type="button" onClick={() => exportPivot('csv')}>
          CSV
        </button>
        <button type="button" onClick={() => exportPivot('xlsx')}>
          XLSX
        </button>
      </section>

      <PivotTable
        pivot={pivot}
        rowLabel={rowLabel}
        format={format}
        sort={sort}
        onSort={onSort}
        onDrill={colField === 'member' ? setDetailMember : undefined}
        onRowClick={canOpenTasks ? (title) => taskIdFor.get(title) && setOpenTaskId(taskIdFor.get(title)) : undefined}
      />

      {openTaskId && <TaskDialog taskId={openTaskId} onClose={() => setOpenTaskId(null)} />}

      {detailMember && (
        <MemberDetail
          member={detailMember}
          members={facets.members}
          entries={filteredExceptMember}
          onChangeMember={setDetailMember}
          onClose={() => setDetailMember(null)}
        />
      )}
    </>
  )
}

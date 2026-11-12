import React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { formatHM } from '../lib/parseWorkbook'
import { buildTimetable, clock, dayLabel, spansMidnight } from '../lib/timetable'
import { buildTimetableWorkbook } from '../lib/exportSpentTime'
import { XLSX } from '../lib/xlsxStyle'

const hours = (v) => (Math.round(v * 100) / 100).toFixed(2)

/** Floats above the table so it is never clipped by the scroll container. */
function HoverCard({ hover }) {
  const { rect, date, task, cell } = hover
  const width = 300
  const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8)
  const below = rect.bottom + 8
  const flip = below + 200 > window.innerHeight
  const style = flip
    ? { left, bottom: window.innerHeight - rect.top + 8, width }
    : { left, top: below, width }

  const l = dayLabel(date)
  return (
    <div className="hovercard" style={style}>
      <div className="hovercard-head">
        <strong>{task}</strong>
        <span>
          {l.weekday} {l.day} · {hours(cell.hours)} h ({formatHM(cell.hours)})
        </span>
      </div>
      {cell.items.map((e) => (
        <div key={e.id} className="hovercard-item">
          <div className="hovercard-range">
            <span>
              {clock(e.start)} – {clock(e.end)}
              {spansMidnight(e) && <sup title="ends the next day">+1</sup>}
            </span>
            <span className="hovercard-hours">{hours(e.hours)}</span>
          </div>
          {e.note && <div className="hovercard-note">{e.note}</div>}
        </div>
      ))}
    </div>
  )
}

export default function MemberDetail({ member, members, entries, onChangeMember, onClose }) {
  const [showTimes, setShowTimes] = useState(false)
  const [hover, setHover] = useState(null)

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const model = useMemo(() => buildTimetable(entries, member), [entries, member])

  // Fixed-layout table: the day columns share whatever is left after the
  // 190px task column and the 62px total column, so a whole month fits.
  const dayWidth = model.dates.length ? `calc((100% - 252px) / ${model.dates.length})` : undefined

  useEffect(() => setHover(null), [member, showTimes])

  const exportSheet = () => {
    const { workbook, fileName } = buildTimetableWorkbook(model, member)
    XLSX.writeFile(workbook, fileName)
  }

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={`Timetable for ${member}`}>
        <header className="modal-head">
          <div>
            <h2>Daily timetable</h2>
            <p>
              {model.entryCount} entries · {hours(model.grand)} h ({formatHM(model.grand)}) ·{' '}
              {model.dates.length} day(s) · hover a cell for exact times
            </p>
          </div>
          <div className="modal-actions">
            <label className="check">
              <input
                type="checkbox"
                checked={showTimes}
                onChange={(e) => setShowTimes(e.target.checked)}
              />
              Times in cells
            </label>
            <select value={member} onChange={(e) => onChangeMember(e.target.value)}>
              {members.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <button type="button" onClick={exportSheet} disabled={!model.dates.length}>
              Export XLSX
            </button>
            <button type="button" className="close" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
        </header>

        {!model.dates.length ? (
          <p className="empty">No entries for {member} with the current filters.</p>
        ) : (
          <div className={`table-wrap detail-wrap${showTimes ? ' wide' : ''}`}>
            <table className="pivot timetable">
              <colgroup>
                <col className="task-col" />
                {model.dates.map((d) => (
                  <col key={d} style={showTimes ? undefined : { width: dayWidth }} />
                ))}
                <col className="sum-col" />
              </colgroup>
              <thead>
                <tr>
                  <th className="corner sticky-col">Task</th>
                  {model.dates.map((d, i) => {
                    const l = dayLabel(d)
                    const span = model.firstLast[i]
                    const spanText = span
                      ? `${clock(span.from)} – ${clock(span.to)}${span.toNextDay ? ' +1' : ''}`
                      : ''
                    return (
                      <th
                        key={d}
                        className={l.weekend ? 'weekend' : undefined}
                        title={`${l.weekday} ${l.day}${spanText ? ` · ${spanText}` : ''}`}
                      >
                        <span className="weekday">{l.weekday}</span>
                        <span className="daynum">{l.dayNum}</span>
                        {(i === 0 || dayLabel(model.dates[i - 1]).month !== l.month) && (
                          <span className="monthtag">{l.month}</span>
                        )}
                        {showTimes && spanText && <span className="dayspan">{spanText}</span>}
                      </th>
                    )
                  })}
                  <th className="total-col">Total</th>
                </tr>
              </thead>
              <tbody>
                {model.tasks.map((t) => (
                  <tr key={t.task}>
                    <th className="sticky-col row-label" title={t.task}>
                      {t.task}
                    </th>
                    {model.dates.map((d) => {
                      const cell = t.days.get(d)
                      if (!cell) {
                        return (
                          <td key={d}>
                            <span className="zero">·</span>
                          </td>
                        )
                      }
                      return (
                        <td key={d} className="slot">
                          <button
                            type="button"
                            className="slot-hours"
                            onMouseEnter={(e) =>
                              setHover({
                                rect: e.currentTarget.getBoundingClientRect(),
                                date: d,
                                task: t.task,
                                cell
                              })
                            }
                            onFocus={(e) =>
                              setHover({
                                rect: e.currentTarget.getBoundingClientRect(),
                                date: d,
                                task: t.task,
                                cell
                              })
                            }
                            onMouseLeave={() => setHover(null)}
                            onBlur={() => setHover(null)}
                          >
                            {hours(cell.hours)}
                            {showTimes && <span className="hm"> ({formatHM(cell.hours)})</span>}
                          </button>
                          {showTimes &&
                            cell.items.map((e) => (
                              <div key={e.id} className="slot-range">
                                {clock(e.start)} – {clock(e.end)}
                                {spansMidnight(e) && <sup title="ends the next day">+1</sup>}
                              </div>
                            ))}
                        </td>
                      )
                    })}
                    <td className="total-col">{hours(t.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th className="sticky-col">Day total</th>
                  {model.dayTotals.map((v, i) => (
                    <td key={model.dates[i]} title={formatHM(v)}>
                      {hours(v)}
                      {showTimes && <span className="hm"> ({formatHM(v)})</span>}
                    </td>
                  ))}
                  <td className="total-col">{hours(model.grand)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {hover && <HoverCard hover={hover} />}
      </div>
    </div>
  )
}

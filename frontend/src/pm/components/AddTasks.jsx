import React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { BACKLOG, defaultSprintId, readyTasks, selectableSprints, sprintLabel } from '../lib/scrum'

let nextKey = 0
const blankRow = (personId, sprintId, featureId = '') => ({
  key: `row_${nextKey++}`,
  title: '',
  notes: '',
  estimate: '',
  personId,
  sprintId,
  featureId
})

/** Outlined so it takes the button's colour; red, because it deletes. */
function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d="M2.5 4.5h11M6 4.5V3a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5v1.5M4 4.5l.6 8.2a.8.8 0 0 0 .8.8h5.2a.8.8 0 0 0 .8-.8l.6-8.2M6.6 7v4M9.4 7v4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * Stages work before it lands on the board: a row per task — title, notes, who
 * it belongs to and the roadmap feature it moves — with + on the last row for
 * as many as are needed. Nothing is added until Done, so a half-typed row is
 * never left on someone's card.
 */
export default function AddTasks({ people, sprints, sprintId, onAdd, onClose }) {
  const firstPerson = people[0]?.id || ''
  // Only the sprint in progress and the ones still to come can be planned into;
  // the label comes from the full list so "Sprint 3" keeps its number.
  const options = useMemo(
    () =>
      selectableSprints(sprints).map((sprint) => ({
        id: sprint.id,
        label: sprintLabel(sprint, sprints.indexOf(sprint))
      })),
    [sprints]
  )
  const startSprint = useMemo(() => defaultSprintId(sprints, sprintId), [sprints, sprintId])

  const [rows, setRows] = useState(() => [blankRow(firstPerson, startSprint)])
  const [defaultPerson, setDefaultPerson] = useState(firstPerson)

  const ready = useMemo(() => readyTasks(rows), [rows])
  const pending = ready.length

  const label = (id) => options.find((o) => o.id === id)?.label || 'the backlog'
  const whereLabel = label(startSprint)

  const close = () => {
    if (pending > 0 && !window.confirm(`Discard ${pending} unsaved task(s)?`)) return
    onClose()
  }

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const update = (key, patch) =>
    setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  /** A new row inherits the person and roadmap link of the one it follows. */
  const addRow = (afterKey = null) => {
    setRows((list) => {
      const at = afterKey ? list.findIndex((r) => r.key === afterKey) : list.length - 1
      const source = list[at] || { personId: defaultPerson, sprintId: startSprint, featureId: '' }
      const row = blankRow(
        source.personId || defaultPerson,
        source.sprintId ?? startSprint,
        source.featureId
      )
      const next = [...list]
      next.splice(at + 1, 0, row)
      requestAnimationFrame(() => {
        document.querySelector(`[data-row-title="${row.key}"]`)?.focus()
      })
      return next
    })
  }

  const removeRow = (key) =>
    setRows((list) =>
      list.length > 1 ? list.filter((r) => r.key !== key) : [blankRow(defaultPerson, startSprint)]
    )

  const done = () => {
    if (ready.length) onAdd(ready)
    onClose()
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal sheet" role="dialog" aria-modal="true" aria-label="Add tasks">
        <div className="modal-head">
          <div>
            <h2>Add tasks</h2>
            <p>
              New work starts in <strong>{whereLabel}</strong> and each row can be moved to another
              sprint — <strong>+</strong> on the last row (or Enter) adds another, then{' '}
              <strong>Done</strong> puts them all on the board.
            </p>
          </div>
          <div className="modal-actions">
            <button type="button" className="close" onClick={close} title="Close without adding">
              ✕
            </button>
          </div>
        </div>

        <div className="modal-body">
          {!people.length ? (
            <p className="empty">Add a person first — a task has to belong to someone.</p>
          ) : (
            <div className="add-rows">
              <div className="add-row head">
                <span>Task</span>
                <span>Notes</span>
                <span>Assign to</span>
                <span>🏃 Sprint</span>
                <span>Est. hours</span>
                <span />
              </div>

              {rows.map((row, i) => (
                <div className={`add-row${row.title.trim() ? ' filled' : ''}`} key={row.key}>
                  <input
                    data-row-title={row.key}
                    value={row.title}
                    autoFocus={i === 0}
                    placeholder="what is being worked on"
                    onChange={(e) => update(row.key, { title: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addRow(row.key)
                      }
                    }}
                  />
                  <input
                    value={row.notes}
                    placeholder="blockers, links, next step"
                    onChange={(e) => update(row.key, { notes: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addRow(row.key)
                      }
                    }}
                  />
                  <select
                    value={row.personId}
                    onChange={(e) => {
                      update(row.key, { personId: e.target.value })
                      setDefaultPerson(e.target.value)
                    }}
                  >
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name.trim() || 'unnamed'}
                      </option>
                    ))}
                  </select>
                  <select
                    value={row.sprintId}
                    title="Which sprint this task goes into"
                    onChange={(e) => update(row.key, { sprintId: e.target.value })}
                  >
                    {options.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                    <option value={BACKLOG}>Backlog</option>
                  </select>
                  <input
                    type="number"
                    min="0"
                    step="0.25"
                    className="add-estimate"
                    value={row.estimate}
                    placeholder="hrs"
                    title="Estimated hours"
                    onChange={(e) => update(row.key, { estimate: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addRow(row.key)
                      }
                    }}
                  />
                  <span className="add-row-actions">
                    <button
                      type="button"
                      className="danger"
                      title="Remove this row"
                      aria-label="Remove this row"
                      onClick={() => removeRow(row.key)}
                      disabled={rows.length === 1 && !row.title.trim() && !row.notes.trim()}
                    >
                      <TrashIcon />
                    </button>
                    {i === rows.length - 1 && (
                      <button
                        type="button"
                        className="icon add-more"
                        title="Add another row"
                        aria-label="Add another row"
                        onClick={() => addRow(row.key)}
                      >
                        +
                      </button>
                    )}
                  </span>
                </div>
            ))}
            </div>
          )}
        </div>

        <div className="modal-foot">
          <span className="muted">
            {pending > 0
              ? `${pending} task(s) ready · ${[...new Set(ready.map((r) => label(r.sprintId)))].join(', ')}`
              : options.length
                ? `New rows start in ${whereLabel}.`
                : 'There is no open sprint — new work goes to the backlog.'}
          </span>
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={done} disabled={!pending}>
            Done{pending > 0 ? ` — add ${pending} task(s)` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}

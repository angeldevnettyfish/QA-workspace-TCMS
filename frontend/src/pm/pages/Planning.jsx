import React from 'react'
import TabStats from '../components/TabStats'
import { useMemo, useState } from 'react'
import {
  ALL_SPRINTS,
  BACKLOG,
  SCRUM_STATUSES,
  byPerson,
  byStatus,
  daysLeft,
  defaultSprintId,
  hours,
  isCurrentSprint,
  editScope,
  moveTask,
  moveTasks,
  patchTasks,
  pivotRows,
  removeTasks,
  rowRun,
  planSprintScope,
  planningRows,
  sortPlanningRows,
  spentHours,
  sprintLabel,
  sprintRange,
  timeTotals,
  touchTask
} from '../lib/scrum'
import { useScrum } from '../lib/scrumState'
import AddTasks from '../components/AddTasks'
import TaskDialog from '../components/TaskDialog'
import PlanningSummaryDialog from '../components/PlanningSummaryDialog'

const pillClass = (status) => `pill ${status.toLowerCase().replace(/\s+/g, '-')}`

/** A bulk dropdown sets a value; this one empties it instead. */
const NO_FEATURE = '--none--'

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

/** Hours read better without trailing zeros, and a blank cell means nothing. */
const h = (value) => (value ? String(Math.round(value * 100) / 100) : '')

/**
 * The planning table: every task of one sprint on one line, with the estimate
 * and the time spent editable in place, and a pivot of those two numbers at the
 * foot. It is the same board as the Scrum tab — the state is shared — so an
 * estimate typed here shows up there and is saved the same way.
 */
export default function Planning() {
  const { people, setPeople, sprints, view, setView, features, addTasks, store } = useScrum()
  const [adding, setAdding] = useState(false)
  const [openTaskId, setOpenTaskId] = useState(null)
  const [mailing, setMailing] = useState(false)
  // Sorting is a way of reading the table, not a setting: it starts off, and a
  // third click on a column puts the board's own order back.
  const [sort, setSort] = useState({ key: '', dir: 'asc' })
  /**
   * The tasks ticked for a bulk edit, and the row a Shift+click measures its
   * run from. Picking rows is a way of working, not a setting, so neither is
   * saved — a reload starts with nothing picked.
   */
  const [picked, setPicked] = useState(() => new Set())
  const [anchor, setAnchor] = useState('')

  // The planning table keeps its own sprint, so it can look at the sprint being
  // planned while the board shows the one being worked on.
  // null means "not chosen yet" and resolves to the sprint running today;
  // ALL_SPRINTS is the explicit "every sprint", which is no filter at all.
  const sprintId = planSprintScope(sprints, view.planSprintId)
  const sprint = sprints.find((s) => s.id === sprintId) || null
  const sprintIndex = sprints.findIndex((s) => s.id === sprintId)

  const rows = useMemo(
    () =>
      planningRows(people, sprintId, {
        hideDone: view.planHideDone,
        personId: view.planPersonId
      }),
    [people, sprintId, view.planHideDone, view.planPersonId]
  )
  const sprintNameOf = (id) => sprints.find((s) => s.id === id)?.name.trim() || ''
  const featureTitleOf = (id) => features.find((f) => f.id === id)?.feature.trim() || ''

  const sorted = useMemo(
    () =>
      sort.key
        ? sortPlanningRows(rows, sort.key, sort.dir, {
            sprintOf: sprintNameOf,
            featureOf: featureTitleOf
          })
        : rows,
    [rows, sort, sprints, features]
  )

  /** Click to sort ascending, again for descending, again for board order. */
  const sortBy = (key) =>
    setSort((current) =>
      current.key !== key
        ? { key, dir: 'asc' }
        : current.dir === 'asc'
          ? { key, dir: 'desc' }
          : { key: '', dir: 'asc' }
    )

  const totals = useMemo(() => timeTotals(rows), [rows])
  const pivot = useMemo(
    () => pivotRows(rows, view.planGroupBy === 'status' ? byStatus : byPerson),
    [rows, view.planGroupBy]
  )


  const updateTask = (personId, taskId, patch) =>
    setPeople((list) =>
      list.map((p) =>
        p.id === personId
          ? { ...p, tasks: p.tasks.map((t) => (t.id === taskId ? touchTask(t, patch) : t)) }
          : p
      )
    )

  /** Reassigning here is the same move the board makes by drag and drop. */
  const reassign = (taskId, toPersonId) => setPeople((list) => moveTask(list, taskId, toPersonId))

  const removeTask = (personId, task) => {
    if (task.title.trim() && !window.confirm(`Delete "${task.title.trim()}"?`)) return
    setPeople((list) =>
      list.map((p) =>
        p.id === personId ? { ...p, tasks: p.tasks.filter((t) => t.id !== task.id) } : p
      )
    )
  }

  /**
   * Only what is both ticked and on screen: filtering the table down must
   * narrow what an edit lands on, never leave it acting on rows nobody can
   * see.
   */
  const marked = useMemo(() => sorted.filter(({ task }) => picked.has(task.id)), [sorted, picked])
  const allMarked = sorted.length > 0 && marked.length === sorted.length
  const markedIds = useMemo(() => marked.map(({ task }) => task.id), [marked])

  /**
   * Ticking a row. Plain or Ctrl+click toggles one; Shift+click takes
   * everything between it and the row ticked last, which is how a run of tasks
   * is picked without twenty clicks.
   */
  const tick = (taskId, shift = false) => {
    setPicked((set) => {
      const next = new Set(set)
      if (shift && anchor) {
        for (const id of rowRun(sorted.map(({ task }) => task.id), anchor, taskId)) next.add(id)
        return next
      }
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
    setAnchor(taskId)
  }

  /**
   * Editing a row that is itself ticked edits every ticked row. Picking three
   * tasks and setting one of them to In Progress means all three — which is
   * what picking them was for. It holds for the fields a whole selection can
   * sensibly share: status, sprint, roadmap link and who holds it. The title
   * and the hours stay the row's own, because copying those across a selection
   * would destroy what it says rather than change it.
   */
  const editRow = (person, task, patch) => {
    const ids = editScope(markedIds, task.id)
    if (ids.length > 1) setPeople((list) => patchTasks(list, ids, patch))
    else updateTask(person.id, task.id, patch)
  }

  const assignRow = (task, personId) => {
    const ids = editScope(markedIds, task.id)
    if (ids.length > 1) setPeople((list) => moveTasks(list, ids, personId))
    else reassign(task.id, personId)
  }

  /** The same change on every ticked task, written in one go. */
  const bulkUpdate = (patch) => {
    if (markedIds.length) setPeople((list) => patchTasks(list, markedIds, patch))
  }

  /** Handing a pile of tasks to one person, the same move the board makes. */
  const bulkAssign = (personId) => {
    if (markedIds.length) setPeople((list) => moveTasks(list, markedIds, personId))
  }

  const bulkRemove = () => {
    if (!markedIds.length || !window.confirm(`Delete ${markedIds.length} task(s)? This cannot be undone.`)) {
      return
    }
    setPeople((list) => removeTasks(list, markedIds))
    setPicked(new Set())
  }

  const left = sprint ? daysLeft(sprint) : null

  return (
    <>
      <TabStats id="planning">
        <div className="stats">
          <div>
            <span>{totals.tasks}</span>
            <small>tasks</small>
          </div>
          <div>
            <span>{h(totals.estimate) || '0'}</span>
            <small>est. hours</small>
          </div>
          <div>
            <span>{h(totals.spent) || '0'}</span>
            <small>spent</small>
          </div>
          {totals.tasks > totals.estimated && (
            <div>
              <span>{totals.tasks - totals.estimated}</span>
              <small>unestimated</small>
            </div>
          )}
        </div>

      </TabStats>

      {!store.loading && !store.online && (
        <p className="warn">The QA backend is not reachable — changes are kept in this browser and will sync once it is running again.</p>
      )}

      <section className="controls">
        <label>
          🏃 Sprint
          <select
            value={sprintId === null ? ALL_SPRINTS : sprintId}
            onChange={(e) => setView((v) => ({ ...v, planSprintId: e.target.value }))}
          >
            {sprints.map((s, i) => (
              <option key={s.id} value={s.id}>
                {sprintLabel(s, i)}
                {isCurrentSprint(s) ? ' · current' : ''}
              </option>
            ))}
            <option value={BACKLOG}>Backlog</option>
            <option value={ALL_SPRINTS}>All sprints</option>
          </select>
        </label>
        <label>
          👤 Person
          <select
            value={view.planPersonId}
            onChange={(e) => setView((v) => ({ ...v, planPersonId: e.target.value }))}
          >
            <option value="">Everyone</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name.trim() || 'unnamed'}
                {p.role.trim() ? ` · ${p.role.trim()}` : ''}
              </option>
            ))}
          </select>
        </label>
        <div className="status-filter">
          <span className="filter-caption">Group the pivot by</span>
          <div className="chips">
            {[
              { id: 'person', label: 'Person' },
              { id: 'status', label: 'Status' }
            ].map((option) => (
              <button
                type="button"
                key={option.id}
                className={`chip${view.planGroupBy === option.id ? ' on' : ''}`}
                onClick={() => setView((v) => ({ ...v, planGroupBy: option.id }))}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={view.planHideDone}
            onChange={(e) => setView((v) => ({ ...v, planHideDone: e.target.checked }))}
          />
          Hide done
        </label>
        {(view.planPersonId || sprintId === null) && (
          <button
            type="button"
            className="link"
            onClick={() =>
              setView((v) => ({ ...v, planPersonId: '', planSprintId: defaultSprintId(sprints) }))
            }
          >
            clear filters
          </button>
        )}
        <div className="spacer" />
        <button type="button" onClick={() => setAdding(true)} disabled={!people.length}>
          + Add task
        </button>
        <button
          type="button"
          onClick={() => setMailing(true)}
          title="Preview and send what was done last sprint and what is planned next"
        >
          ✉ Planning Summary Email
        </button>
        <span className="muted plan-scope">
          {sprint ? (
            <>
              {sprintRange(sprint)}
              {isCurrentSprint(sprint) && <span className="ck-flag">current</span>}
              {left !== null && left >= 0 ? ` · ${left} day(s) left` : ''}
            </>
          ) : sprintId === BACKLOG ? (
            'Tasks with no sprint'
          ) : (
            'Every sprint and the backlog'
          )}
          {' · '}
          {totals.open} open · {totals.done} done
        </span>
      </section>

      {!rows.length ? (
        <p className="empty">
          {sprints.length
            ? 'Nothing in this sprint yet — add tasks on the Scrum tab, or pick another sprint.'
            : 'No sprints yet — add one on the Scrum tab to plan into it.'}
        </p>
      ) : (
        <>
        {marked.length > 0 && (
          <section className="bulk-bar">
            <strong>
              {marked.length} of {sorted.length} picked
            </strong>
            <span className="muted">
              {marked.length > 1
                ? 'change one of them below and all of them follow'
                : 'pick another to change them together'}
            </span>
            <label>
              Status
              <select value="" onChange={(e) => e.target.value && bulkUpdate({ status: e.target.value })}>
                <option value="">— set status —</option>
                {SCRUM_STATUSES.map((st) => (
                  <option key={st}>{st}</option>
                ))}
              </select>
            </label>
            <label>
              👤 Person
              <select value="" onChange={(e) => e.target.value && bulkAssign(e.target.value)}>
                <option value="">— hand to —</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name.trim() || 'unnamed'}
                  </option>
                ))}
              </select>
            </label>
            <label>
              🏃 Sprint
              <select value="" onChange={(e) => e.target.value && bulkUpdate({ sprintId: e.target.value === BACKLOG ? BACKLOG : e.target.value })}>
                <option value="">— move to —</option>
                {sprints.map((sp, i) => (
                  <option key={sp.id} value={sp.id}>
                    {sprintLabel(sp, i)}
                  </option>
                ))}
                <option value={BACKLOG}>Backlog</option>
              </select>
            </label>
            <div className="spacer" />
            <button type="button" className="link" onClick={() => setPicked(new Set())}>
              Clear the selection
            </button>
            <button type="button" className="danger" onClick={bulkRemove}>
              ✕ Delete {marked.length}
            </button>
          </section>
        )}
        <div className="table-wrap">
          <table className="pivot plan-table">
            <thead>
              <tr>
                <th className="pick-col">
                  <input
                    type="checkbox"
                    checked={allMarked}
                    ref={(el) => {
                      if (el) el.indeterminate = marked.length > 0 && !allMarked
                    }}
                    title={allMarked ? 'Unpick everything shown' : `Pick all ${sorted.length} shown`}
                    onChange={(e) =>
                      setPicked(e.target.checked ? new Set(sorted.map(({ task }) => task.id)) : new Set())
                    }
                  />
                </th>
                {[
                  { key: 'person', label: 'Person', left: true },
                  { key: 'task', label: 'Task', left: true },
                  { key: 'status', label: 'Status', left: true },
                  { key: 'sprint', label: '🏃 Sprint', left: true },
                  { key: 'estimate', label: 'Est. h' },
                  { key: 'spent', label: 'Spent h' },
                  { key: 'result', label: 'Result', left: true },
                  { key: 'issues', label: 'Issues' },
                  { key: '', label: '' }
                ].map((column) => (
                  <th
                    key={column.key || 'actions'}
                    className={column.left ? 'left' : undefined}
                    aria-sort={
                      column.key && sort.key === column.key
                        ? sort.dir === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                    }
                  >
                    {!column.key ? null : (
                    <button
                      type="button"
                      className={`sort-head${sort.key === column.key ? ' on' : ''}`}
                      title={
                        sort.key !== column.key
                          ? `Sort by ${column.label}`
                          : sort.dir === 'asc'
                            ? 'Sort the other way'
                            : 'Back to the board order'
                      }
                      onClick={() => sortBy(column.key)}
                    >
                      {column.label}
                      <span className="sort-mark" aria-hidden="true">
                        {sort.key === column.key ? (sort.dir === 'asc' ? '▲' : '▼') : '⇅'}
                      </span>
                    </button>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map(({ person, task }) => {
                return (
                  <tr key={task.id} className={picked.has(task.id) ? 'picked' : undefined}>
                    <td className="pick-col">
                      <input
                        type="checkbox"
                        checked={picked.has(task.id)}
                        title="Pick this task — Shift+click for a run of them"
                        onClick={(e) => e.shiftKey && tick(task.id, true)}
                        onChange={(e) => !e.nativeEvent.shiftKey && tick(task.id)}
                      />
                    </td>
                    <th className="left sticky-col">
                      <select
                        className="task-select person-select"
                        value={person.id}
                        title="Hand this task to someone else"
                        onChange={(e) => assignRow(task, e.target.value)}
                      >
                        {people.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name.trim() || 'unnamed'}
                          </option>
                        ))}
                      </select>
                    </th>
                    <td className="left">
                      <button
                        type="button"
                        className="link task-open"
                        title="Open this task: testing results, time spent and details"
                        onClick={() => setOpenTaskId(task.id)}
                      >
                        {task.title.trim() || 'untitled'}
                      </button>
                    </td>
                    <td className="left">
                      <select
                        className={pillClass(task.status)}
                        value={task.status}
                        onChange={(e) => editRow(person, task, { status: e.target.value })}
                      >
                        {SCRUM_STATUSES.map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </td>
                    <td className="left">
                      <select
                        className="task-select"
                        value={task.sprintId}
                        title="Move this task to another sprint"
                        onChange={(e) => editRow(person, task, { sprintId: e.target.value })}
                      >
                        <option value={BACKLOG}>Backlog</option>
                        {sprints.map((s, i) => (
                          <option key={s.id} value={s.id}>
                            {sprintLabel(s, i)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        className="cell-input hours"
                        type="number"
                        min="0"
                        step="0.5"
                        value={task.estimate || ''}
                        placeholder="—"
                        onChange={(e) => updateTask(person.id, task.id, { estimate: hours(e.target.value) })}
                      />
                    </td>
                    <td>
                      {task.entries.length ? (
                        <span
                          className="tracked"
                          title={`${task.entries.length} time entr${task.entries.length === 1 ? 'y' : 'ies'} on the board — start and stop the clock there`}
                        >
                          {spentHours(task)}
                          <small>⏱</small>
                        </span>
                      ) : (
                        <input
                          className="cell-input hours"
                          type="number"
                          min="0"
                          step="0.5"
                          value={task.spent || ''}
                          placeholder="—"
                          onChange={(e) => updateTask(person.id, task.id, { spent: hours(e.target.value) })}
                        />
                      )}
                    </td>
                    <td className="left">
                      <span className={`pill result-${task.testResult.toLowerCase().replace(/\s+/g, '-')}`}>{task.testResult}</span>
                    </td>
                    <td>
                      <input
                        className="cell-input hours"
                        type="number"
                        min="0"
                        step="1"
                        value={task.issues || ''}
                        placeholder="0"
                        title="Issues entered against this task"
                        onChange={(e) => updateTask(person.id, task.id, { issues: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                      />
                    </td>
                    <td className="row-actions">
                      <button
                        type="button"
                        className="danger"
                        title="Delete this task"
                        aria-label="Delete this task"
                        onClick={() => removeTask(person.id, task)}
                      >
                        <TrashIcon />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className="pick-col" />
                <th className="left sticky-col">All</th>
                <td className="left muted">
                  {totals.tasks} task(s){totals.tasks > totals.estimated ? ` · ${totals.tasks - totals.estimated} unestimated` : ''}
                  {sort.key && (
                    <button type="button" className="link" onClick={() => setSort({ key: '', dir: 'asc' })}>
                      clear sort
                    </button>
                  )}
                </td>
                <td className="left muted">
                  {totals.open} open · {totals.done} done
                </td>
                <td />
                <td />
                <td>{h(totals.estimate) || '—'}</td>
                <td>{h(totals.spent) || '—'}</td>
                <td />
                <td>{totals.issues || ''}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        </>
      )}


      {mailing && <PlanningSummaryDialog mode="planning" onClose={() => setMailing(false)} />}

      {openTaskId && <TaskDialog taskId={openTaskId} onClose={() => setOpenTaskId(null)} />}

      {adding && (
        <AddTasks
          people={people}
          sprints={sprints}
          sprintId={sprintId === null ? BACKLOG : sprintId}
          onAdd={addTasks}
          onClose={() => setAdding(false)}
        />
      )}

      {rows.length > 0 && (
        <section className="plan-pivot">
          <h2>
            Planned hours by {view.planGroupBy === 'status' ? 'status' : 'person'}
            {sprint ? ` · ${sprintLabel(sprint, sprintIndex)}` : sprintId === BACKLOG ? ' · backlog' : ' · every sprint'}
          </h2>
          <div className="table-wrap">
            <table className="pivot">
              <thead>
                <tr>
                  <th className="left">{view.planGroupBy === 'status' ? 'Status' : 'Person'}</th>
                  <th>Tasks</th>
                  <th>Open</th>
                  <th>Done</th>
                  <th>Est. h</th>
                  <th>Spent h</th>
                </tr>
              </thead>
              <tbody>
                {pivot.map((group) => (
                  <tr key={group.key}>
                    <th className="left sticky-col">{group.label}</th>
                    <td>{group.tasks}</td>
                    <td>{group.open || <span className="zero">0</span>}</td>
                    <td>{group.done || <span className="zero">0</span>}</td>
                    <td>{h(group.estimate) || <span className="zero">0</span>}</td>
                    <td>{h(group.spent) || <span className="zero">0</span>}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th className="left sticky-col">Total</th>
                  <td>{totals.tasks}</td>
                  <td>{totals.open}</td>
                  <td>{totals.done}</td>
                  <td>{h(totals.estimate) || '—'}</td>
                  <td>{h(totals.spent) || '—'}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}
    </>
  )
}

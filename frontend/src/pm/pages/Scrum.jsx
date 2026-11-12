import React from 'react'
import TabStats from '../components/TabStats'
import { useEffect, useMemo, useState } from 'react'
import {
  BACKLOG,
  SCRUM_STATUSES,
  blankEntry,
  blankNote,
  blankSprint,
  blankTask,
  boardStats,
  daysLeft,
  elapsedLabel,
  filterBoard,
  fromLocalInput,
  entryHours,
  isCurrentSprint,
  isRunning,
  moveTask,
  moveTaskTo,
  newId,
  nextSprintWindow,
  SPRINT_DAYS,
  addDays,
  noteDateLabel,
  personStats,
  pruneSprintIds,
  runningEntry,
  sortTasks,
  sortedLog,
  spentHours,
  startTaskFor,
  stopTimer,
  toLocalInput,
  trackedHours,
  sprintLabel,
  sprintRange,
  sprintStats,
  todayISO,
  touchTask
} from '../lib/scrum'
import { useScrum } from '../lib/scrumState'
import AddTasks from '../components/AddTasks'
import AddPerson from '../components/AddPerson'
import PlanningSummaryDialog from '../components/PlanningSummaryDialog'

const pillClass = (status) => `pill ${status.toLowerCase().replace(/\s+/g, '-')}`

function Progress({ done, total }) {
  const share = total ? Math.round((done / total) * 100) : 0
  return (
    <span className="sprint-progress" title={`${done} of ${total} done`}>
      <span className="bar">
        <i style={{ width: `${share}%` }} />
      </span>
      <small>
        {done}/{total} done
      </small>
    </span>
  )
}

export default function Scrum() {
  const {
    people,
    setPeople,
    sprints,
    setSprints,
    view,
    setView,
    addPersonCard,
    addTasks,
    day,
    setDay,
    store
  } = useScrum()
  const [query, setQuery] = useState('')
    const [adding, setAdding] = useState(false)
  const [mailing, setMailing] = useState(false)
  const [seating, setSeating] = useState(false)
  const [focusId, setFocusId] = useState(null)
  const [expanded, setExpanded] = useState(() => new Set())
  const [drag, setDrag] = useState(null)
  const [mine, setMine] = useState(false)
  const [openTimes, setOpenTimes] = useState(() => new Set())
  const [now, setNow] = useState(() => Date.now())

  // A running clock has to look like one; nothing ticks when nothing is running.
  const anyRunning = useMemo(
    () => people.some((person) => person.tasks.some(isRunning)),
    [people]
  )
  useEffect(() => {
    if (!anyRunning) return undefined
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [anyRunning])

  const statuses = useMemo(() => new Set(view.statuses), [view.statuses])
  const setSprintId = (sprintId) => setView((v) => ({ ...v, sprintId }))

  // The header counts the sprint in view, but not the search or the chips —
  // those are about what is on screen, not about how much work there is.
  const inScope = useMemo(
    () =>
      people.map((p) => ({
        ...p,
        tasks: view.sprintId === null ? p.tasks : p.tasks.filter((t) => t.sprintId === view.sprintId)
      })),
    [people, view.sprintId]
  )
  const stats = useMemo(() => boardStats(inScope), [inScope])

  // Whoever is signed in, as a card on the board — nobody, if they have none.
  const me = null

  const visible = useMemo(() => {
    const rows = filterBoard(people, {
      query,
      statuses,
      hideDone: view.hideDone,
      sprintId: view.sprintId
    })
    return mine && me ? rows.filter(({ person }) => person.id === me.id) : rows
  }, [people, query, statuses, view.hideDone, view.sprintId, mine, me])

  const selected = sprints.find((s) => s.id === view.sprintId) || null
  const selectedIndex = sprints.findIndex((s) => s.id === view.sprintId)

  const updatePerson = (id, patch) =>
    setPeople((list) => list.map((p) => (p.id === id ? { ...p, ...patch } : p)))

  const updateTask = (personId, taskId, patch) =>
    setPeople((list) =>
      list.map((p) =>
        p.id === personId
          ? { ...p, tasks: p.tasks.map((t) => (t.id === taskId ? touchTask(t, patch) : t)) }
          : p
      )
    )

  /**
   * Adding a person is choosing one of the people who can sign in: the board
   * and that list are the same list, so a card is never made for somebody the
   * app has never heard of.
   */
  const seatPerson = (who) => {
    const person = addPersonCard(who)
    setQuery('')
    requestAnimationFrame(() => {
      document.querySelector(`[data-person-input="${person.id}"]`)?.focus()
    })
  }

  const removePerson = (person) => {
    const label = person.name.trim() || 'this person'
    if (person.tasks.length && !window.confirm(`Delete ${label} and their ${person.tasks.length} task(s)?`)) {
      return
    }
    setPeople((list) => list.filter((p) => p.id !== person.id))
  }

  /** A task added while one sprint is in view belongs to that sprint. */
  const addTask = (person) => {
    const task = {
      ...blankTask(),
      id: newId('tk'),
      sprintId: view.sprintId === null ? BACKLOG : view.sprintId
    }
    setPeople((list) =>
      list.map((p) => (p.id === person.id ? { ...p, tasks: [...p.tasks, task] } : p))
    )
    requestAnimationFrame(() => {
      document.querySelector(`[data-task-input="${task.id}"]`)?.focus()
    })
  }

  const removeTask = (personId, task) => {
    if (task.title.trim() && !window.confirm(`Delete "${task.title.trim()}"?`)) return
    setPeople((list) =>
      list.map((p) => (p.id === personId ? { ...p, tasks: p.tasks.filter((t) => t.id !== task.id) } : p))
    )
  }

  const reassign = (taskId, toPersonId) => setPeople((list) => moveTask(list, taskId, toPersonId))

  /**
   * One note per day per person: asking for today's note twice focuses the one
   * that is already there instead of stacking up empty duplicates.
   */
  const addNote = (person, date = day) => {
    const existing = (person.log || []).find((n) => n.date === date)
    const note = existing || { ...blankNote(), id: newId('nt'), date }
    if (!existing) {
      updatePerson(person.id, { log: [...(person.log || []), note] })
    }
    requestAnimationFrame(() => {
      document.querySelector(`[data-note-input="${note.id}"]`)?.focus()
    })
  }

  const updateNote = (personId, noteId, patch) =>
    setPeople((list) =>
      list.map((p) =>
        p.id === personId
          ? { ...p, log: (p.log || []).map((n) => (n.id === noteId ? { ...n, ...patch } : n)) }
          : p
      )
    )

  const removeNote = (personId, note) => {
    if (note.text.trim() && !window.confirm(`Delete the note from ${note.date}?`)) return
    setPeople((list) =>
      list.map((p) => (p.id === personId ? { ...p, log: (p.log || []).filter((n) => n.id !== note.id) } : p))
    )
  }

  const start = (person, task) =>
    setPeople((list) => startTaskFor(list, person.id, task.id))

  const stop = (person, task) =>
    setPeople((list) =>
      list.map((p) =>
        p.id === person.id
          ? { ...p, tasks: p.tasks.map((t) => (t.id === task.id ? stopTimer(t) : t)) }
          : p
      )
    )

  const toggleTimes = (taskId) =>
    setOpenTimes((prev) => {
      const next = new Set(prev)
      next.has(taskId) ? next.delete(taskId) : next.add(taskId)
      return next
    })

  /** A row typed in by hand, for work done away from the keyboard. */
  const addEntry = (person, task) =>
    updateTask(person.id, task.id, {
      entries: [...task.entries, { ...blankEntry(), id: newId('en'), start: new Date().toISOString() }]
    })

  const updateEntry = (person, task, entryId, patch) =>
    updateTask(person.id, task.id, {
      entries: task.entries.map((e) => (e.id === entryId ? { ...e, ...patch } : e))
    })

  const removeEntry = (person, task, entryId) =>
    updateTask(person.id, task.id, { entries: task.entries.filter((e) => e.id !== entryId) })

  /** Drag and drop: onto another task to place it, onto a card to reassign. */
  const dropOnTask = (toPersonId, targetTaskId, after) => {
    if (!drag) return
    setPeople((list) => moveTaskTo(list, drag.taskId, toPersonId, targetTaskId, after))
    setDrag(null)
  }

  const dropOnPerson = (toPersonId) => {
    if (!drag) return
    setPeople((list) => moveTaskTo(list, drag.taskId, toPersonId))
    setDrag(null)
  }

  /** Alt+↑ / Alt+↓ on the handle, for moving a task without a mouse. */
  const nudgeTask = (person, task, delta) => {
    const order = sortTasks(person.tasks)
    const at = order.findIndex((t) => t.id === task.id)
    const target = order[at + delta]
    if (!target) return
    setPeople((list) => moveTaskTo(list, task.id, person.id, target.id, delta > 0))
  }

  const toggleLog = (personId) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(personId) ? next.delete(personId) : next.add(personId)
      return next
    })


  /**
   * A new sprint comes pre-filled with the next window — Thursday to the
   * following Wednesday — and the name that matches its week, so the usual case
   * needs no typing at all. Everything stays editable.
   */
  const addSprint = () => {
    const next = nextSprintWindow(sprints)
    const sprint = {
      ...blankSprint(),
      id: newId('sp'),
      name: next.name,
      start: next.start,
      end: next.end
    }
    setSprints((list) => [...list, sprint])
    setSprintId(sprint.id)
    requestAnimationFrame(() => {
      document.querySelector(`[data-sprint-input="${sprint.id}"]`)?.select()
    })
  }

  const updateSprint = (id, patch) =>
    setSprints((list) => list.map((s) => (s.id === id ? { ...s, ...patch } : s)))

  /** Deleting a sprint keeps its tasks: they drop back into the backlog. */
  const removeSprint = (sprint) => {
    const held = sprintStats(people, sprint.id).total
    const label = sprint.name.trim() || 'this sprint'
    if (held && !window.confirm(`Delete ${label}? Its ${held} task(s) go back to the backlog.`)) return
    const left = sprints.filter((s) => s.id !== sprint.id)
    setSprints(left)
    setPeople((list) => pruneSprintIds(list, left))
    setSprintId(null)
  }

  const toggleStatus = (status) =>
    setView((v) => ({
      ...v,
      statuses: v.statuses.includes(status)
        ? v.statuses.filter((s) => s !== status)
        : [...v.statuses, status]
    }))

  const today = todayISO()
  const backlogCount = useMemo(() => sprintStats(people, BACKLOG), [people])
  const [sprintMenu, setSprintMenu] = useState(false)
  // Newest first; the latest one gets its own chip, the rest live in the list.
  const sortedSprints = useMemo(
    () => [...sprints].sort((a, b) => (b.start || '').localeCompare(a.start || '')),
    [sprints]
  )
  const latestSprint = sortedSprints[0] || null
  const allCount = useMemo(() => people.reduce((n, person) => n + person.tasks.length, 0), [people])
  const menuLabel = useMemo(() => {
    if (view.sprintId === null) return { text: 'All sprints', active: true }
    if (view.sprintId === BACKLOG) return { text: 'Backlog', active: true }
    const chosen = sprints.find((s) => s.id === view.sprintId)
    if (chosen && chosen.id !== latestSprint?.id) {
      return {
        text: sprintLabel(chosen, sprints.indexOf(chosen)),
        active: true
      }
    }
    return { text: 'All sprints', active: false }
  }, [view.sprintId, sprints, people, allCount, backlogCount, latestSprint])
  const left = selected ? daysLeft(selected) : null

  return (
    <>
      <TabStats id="scrum">
        {(people.length > 0 || sprints.length > 0) && (
          <div className="stats">
            <div>
              <span>{stats.people}</span>
              <small>people</small>
            </div>
            <div>
              <span>{stats.open}</span>
              <small>ongoing</small>
            </div>
            {stats.Blocked > 0 && (
              <div>
                <span>{stats.Blocked}</span>
                <small>blocked</small>
              </div>
            )}
            <div>
              <span>{stats.done}</span>
              <small>done</small>
            </div>
          </div>
        )}

      </TabStats>

      <section className="sprint-bar">
        <span className="filter-caption">Sprint</span>
        <div className="chips">
          {latestSprint && (
            <button
              type="button"
              className={`chip${view.sprintId === latestSprint.id ? ' on' : ''}${isCurrentSprint(latestSprint) ? ' current' : ''}`}
              onClick={() => setSprintId(latestSprint.id)}
              title={`Latest sprint · ${sprintRange(latestSprint)}`}
            >
              {sprintLabel(latestSprint, sprints.indexOf(latestSprint))}
            </button>
          )}
          <div className="sprint-menu">
            <button
              type="button"
              className={`chip sprint-menu-button${menuLabel.active ? ' on' : ''}`}
              aria-haspopup="listbox"
              aria-expanded={sprintMenu}
              onClick={() => setSprintMenu((open) => !open)}
              title="Choose any sprint, all sprints or the backlog"
            >
              {menuLabel.text} ▾
            </button>
            {sprintMenu && (
              <>
                <div className="sprint-menu-backdrop" onClick={() => setSprintMenu(false)} />
                <ul className="sprint-menu-list" role="listbox" aria-label="Sprints">
                  {[
                    { id: null, label: 'All sprints', count: allCount, hint: 'Every sprint and the backlog' },
                    ...sortedSprints.map((sprint) => ({
                      id: sprint.id,
                      label: sprintLabel(sprint, sprints.indexOf(sprint)),
                      count: sprintStats(people, sprint.id).total,
                      hint: sprintRange(sprint),
                      current: isCurrentSprint(sprint)
                    })),
                    { id: BACKLOG, label: 'Backlog', count: backlogCount.total, hint: 'Tasks that are not in a sprint yet' }
                  ].map((option) => (
                    <li key={String(option.id)} role="option" aria-selected={view.sprintId === option.id}>
                      <button
                        type="button"
                        className={view.sprintId === option.id ? 'on' : undefined}
                        title={option.hint}
                        onClick={() => {
                          setSprintId(option.id)
                          setSprintMenu(false)
                        }}
                      >
                        <span>
                          {option.current && <span className="dot" aria-hidden="true">● </span>}
                          {option.label}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
        <div className="spacer" />
        <button type="button" onClick={addSprint}>
          + Add sprint
        </button>
      </section>

      {selected && (
        <section className="sprint-detail">
          <label className="grow-input">
            Sprint name
            <input
              data-sprint-input={selected.id}
              value={selected.name}
              placeholder={`Sprint ${selectedIndex + 1}`}
              onChange={(e) => updateSprint(selected.id, { name: e.target.value })}
            />
          </label>
          <label>
            Starts
            <input
              type="date"
              value={selected.start}
              onChange={(e) => {
                const start = e.target.value
                // Moving the start keeps a two-week sprint two weeks long.
                const keepLength = start && (!selected.end || selected.end === addDays(selected.start, SPRINT_DAYS - 1))
                updateSprint(selected.id, keepLength ? { start, end: addDays(start, SPRINT_DAYS - 1) } : { start })
              }}
            />
          </label>
          <label>
            Ends
            <input
              type="date"
              value={selected.end}
              max="2999-12-31"
              onChange={(e) => updateSprint(selected.id, { end: e.target.value })}
            />
          </label>
          <div className="sprint-meta">
            <span className="muted">
              {sprintRange(selected)}
              {isCurrentSprint(selected) && <span className="ck-flag">current</span>}
              {left !== null && !isCurrentSprint(selected) && left < 0 && (
                <span className="ck-flag dup">ended</span>
              )}
              {left !== null && left >= 0 && ` · ${left} day(s) left`}
            </span>
            <Progress done={sprintStats(people, selected.id).done} total={sprintStats(people, selected.id).total} />
          </div>
          <button type="button" className="danger-text" onClick={() => removeSprint(selected)}>
            Delete sprint
          </button>
        </section>
      )}

      <section className="controls board-controls">
        <label className="grow-input">
          Search
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="filter people or tasks"
          />
        </label>
        <div className="status-filter">
          <span className="filter-caption">
            Status
            {view.statuses.length > 0 && (
              <button
                type="button"
                className="link"
                onClick={() => setView((v) => ({ ...v, statuses: [] }))}
              >
                clear
              </button>
            )}
          </span>
          <div className="chips">
            {SCRUM_STATUSES.map((s) => (
              <button
                type="button"
                key={s}
                className={`chip${statuses.has(s) ? ' on' : ''}`}
                title={`${stats[s]} task(s) — click to show only ${s}`}
                onClick={() => toggleStatus(s)}
              >
                {s} <span className="chip-count">{stats[s]}</span>
              </button>
            ))}
          </div>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={view.hideDone}
            onChange={(e) => setView((v) => ({ ...v, hideDone: e.target.checked }))}
          />
          Hide done
        </label>
        <label className="note-day">
          Notes for
          <span>
            <input
              type="date"
              value={day}
              max={todayISO()}
              onChange={(e) => setDay(e.target.value || todayISO())}
            />
            {day !== todayISO() && (
              <button type="button" className="link" onClick={() => setDay(todayISO())}>
                today
              </button>
            )}
          </span>
        </label>
        <div className="spacer" />
        <button
          type="button"
          onClick={() => setAdding(true)}
          disabled={!people.length}
          title="Add one task, or paste a list of them"
        >
          + Add task
        </button>
        <button
          type="button"
          onClick={() => setMailing(true)}
          disabled={!people.length}
          title="Preview and email every tester's notes for the day"
        >
          ✉ Send Email
        </button>
        <button type="button" className="primary" onClick={() => setSeating(true)}>
          + Add person
        </button>
      </section>

      {!store.loading && !store.online && (
        <p className="warn">
          The API server is not reachable{store.error ? ` (${store.error})` : ''} — changes are kept
          in this browser and will sync once the QA backend is running again.
        </p>
      )}
      {store.migrated > 0 && (
        <p className="warn">
          Moved {store.migrated} person(s) that were stored in this browser into the database.
        </p>
      )}

      {!people.length ? (
        <p className="empty">
          No one on the board yet — <strong>+ Add person</strong> starts it off, and{' '}
          <strong>+ Add sprint</strong> gives their tasks a sprint to sit in.
        </p>
      ) : !visible.length ? (
        <p className="empty">No people or tasks match the current sprint, status filter or search.</p>
      ) : (
        <div className={`scrum-board${focusId ? ' focused' : ''}`}>
          {(focusId ? visible.filter(({ person }) => person.id === focusId) : visible).map(
            ({ person, tasks }) => {
            const s = personStats(person)
            // Collapsed, a card shows the one task that is actually moving; the
            // expand button opens the rest.
            const cardOpen = focusId === person.id
            // In Progress first, then the order tasks were dragged into; a
            // collapsed card shows whichever task that puts on top.
            const order = sortTasks(tasks)
            const shownTasks = cardOpen ? order : order.slice(0, 1)
            const hidden = order.length - shownTasks.length
            return (
              <section
                className={`person-card${drag && drag.overPersonId === person.id ? ' drop-target' : ''}${
                  me && me.id === person.id ? ' is-me' : ''
                }`}
                key={person.id}
                onDragOver={(e) => {
                  if (!drag) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  setDrag((d) => (d ? { ...d, overPersonId: person.id, overTaskId: null } : d))
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  dropOnPerson(person.id)
                }}
              >
                <div className="person-head">
                  <input
                    className="cell-input person-name"
                    data-person-input={person.id}
                    value={person.name}
                    placeholder="Name"
                    onChange={(e) => updatePerson(person.id, { name: e.target.value })}
                  />
                  <span className="person-head-actions">
                    <button
                      type="button"
                      className={`icon${focusId === person.id ? ' on' : ''}`}
                      title={
                        focusId === person.id
                          ? 'Back to the whole board'
                          : `Show only ${person.name.trim() || 'this person'} and all their tasks`
                      }
                      onClick={() => setFocusId(focusId === person.id ? null : person.id)}
                    >
                      {focusId === person.id ? '⤡' : '⤢'}
                    </button>
                    <button
                      type="button"
                      className="danger"
                      title="Remove this person"
                      onClick={() => removePerson(person)}
                    >
                      ✕
                    </button>
                  </span>
                  <span className="person-tally">
                    {s.open} ongoing
                    {s['In Progress'] > 0 ? ` · ${s['In Progress']} in progress` : ''}
                    {s.Blocked > 0 ? ` · ${s.Blocked} blocked` : ''}
                    {s.done > 0 ? ` · ${s.done} done` : ''}
                  </span>
                </div>

                {(() => {
                  // The board is about the day being looked at, so that is the
                  // note on the card. The rest is history: a click away rather
                  // than three lines down every card, and nothing is deleted.
                  const all = sortedLog(person)
                  const onDay = all.filter((n) => n.date === day)
                  const earlier = all.filter((n) => n.date !== day)
                  const logOpen = expanded.has(person.id)
                  const shown = logOpen ? [...onDay, ...earlier] : onDay
                  const hasToday = onDay.length > 0
                  return (
                    <div className="daily-log">
                      <div className="log-head">
                        <span>Daily notes</span>
                        <button
                          type="button"
                          className="link"
                          onClick={() => addNote(person)}
                          title={`Write the note for ${noteDateLabel(day, today)}`}
                        >
                          {hasToday ? 'edit' : '+'} {noteDateLabel(day, today)}
                        </button>
                      </div>
                      {!shown.length ? (
                        <p className="person-empty">
                          {earlier.length
                            ? `Nothing noted ${noteDateLabel(day, today)}.`
                            : 'No notes yet.'}
                        </p>
                      ) : (
                        <ul className="log-list">
                          {shown.map((note) => (
                            <li
                              key={note.id}
                              className={`note${note.date === day ? ' today' : ''}`}
                            >
                              <input
                                className="note-date"
                                type="date"
                                value={note.date}
                                max={todayISO()}
                                title={noteDateLabel(note.date, today)}
                                onChange={(e) =>
                                  updateNote(person.id, note.id, { date: e.target.value || day })
                                }
                              />
                              <input
                                className="cell-input note-text"
                                data-note-input={note.id}
                                value={note.text}
                                placeholder={`what happened ${noteDateLabel(note.date, today)}`}
                                onChange={(e) => updateNote(person.id, note.id, { text: e.target.value })}
                              />
                              <button
                                type="button"
                                className="danger"
                                title="Delete this note"
                                onClick={() => removeNote(person.id, note)}
                              >
                                ✕
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      {earlier.length > 0 && (
                        <button type="button" className="link" onClick={() => toggleLog(person.id)}>
                          {logOpen
                            ? `show only ${noteDateLabel(day, today)}`
                            : `${earlier.length} earlier note(s)`}
                        </button>
                      )}
                    </div>
                  )
                })()}

                {!tasks.length ? (
                  <p className="person-empty">
                    {person.tasks.length
                      ? 'Nothing here in this view.'
                      : 'No tasks yet.'}
                  </p>
                ) : (
                  <ul className="task-list">
                    {shownTasks.map((task) => (
                      <li
                        key={task.id}
                        draggable={drag?.armed === task.id}
                        className={[
                          'task',
                          task.status.toLowerCase().replace(/\s+/g, '-'),
                          task.featureId ? 'linked' : '',
                          drag?.taskId === task.id ? 'dragging' : '',
                          drag?.overTaskId === task.id && drag?.taskId !== task.id
                            ? `drop-target ${drag.after ? 'after' : 'before'}`
                            : ''
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = 'move'
                          e.dataTransfer.setData('text/plain', task.id)
                          setDrag({
                            taskId: task.id,
                            armed: task.id,
                            overTaskId: null,
                            overPersonId: null,
                            after: false
                          })
                        }}
                        onDragOver={(e) => {
                          if (!drag) return
                          e.preventDefault()
                          e.stopPropagation()
                          e.dataTransfer.dropEffect = 'move'
                          const box = e.currentTarget.getBoundingClientRect()
                          const after = e.clientY > box.top + box.height / 2
                          setDrag((d) =>
                            d ? { ...d, overTaskId: task.id, overPersonId: null, after } : d
                          )
                        }}
                        onDrop={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          dropOnTask(person.id, task.id, drag?.after)
                        }}
                        onDragEnd={() => setDrag(null)}
                      >
                        <div className="task-row">
                          <button
                            type="button"
                            className="drag-handle"
                            title="Drag to reorder or move to someone else — or Alt+↑ / Alt+↓"
                            aria-label={`Move ${task.title || 'task'}`}
                            onMouseDown={() =>
                              setDrag({
                                taskId: null,
                                armed: task.id,
                                overTaskId: null,
                                overPersonId: null,
                                after: false
                              })
                            }
                            onMouseUp={() => setDrag((d) => (d?.taskId ? d : null))}
                            onKeyDown={(e) => {
                              if (e.key === 'ArrowUp' && e.altKey) {
                                e.preventDefault()
                                nudgeTask(person, task, -1)
                              }
                              if (e.key === 'ArrowDown' && e.altKey) {
                                e.preventDefault()
                                nudgeTask(person, task, 1)
                              }
                            }}
                          >
                            ⠿
                          </button>
                          <select
                            className={pillClass(task.status)}
                            value={task.status}
                            title="Status"
                            onChange={(e) => updateTask(person.id, task.id, { status: e.target.value })}
                          >
                            {SCRUM_STATUSES.map((s) => (
                              <option key={s}>{s}</option>
                            ))}
                          </select>
                          <input
                            className="cell-input task-title"
                            data-task-input={task.id}
                            value={task.title}
                            placeholder="What is being worked on"
                            onChange={(e) => updateTask(person.id, task.id, { title: e.target.value })}
                          />
                          {(() => {
                            const running = isRunning(task)
                            const logged = spentHours(task, now)
                            return (
                              <>
                                <button
                                  type="button"
                                  className={`timer${running ? ' on' : ''}`}
                                  title={
                                    running
                                      ? 'Stop the clock and record the end time'
                                      : 'Start the clock on this task'
                                  }
                                  onClick={() => (running ? stop(person, task) : start(person, task))}
                                >
                                  {running ? `⏹ ${elapsedLabel(runningEntry(task), now)}` : '▶'}
                                </button>
                                <button
                                  type="button"
                                  className={`logged${task.entries.length ? ' has' : ''}`}
                                  title={`${task.entries.length} time entr(y/ies) — click to list them`}
                                  onClick={() => toggleTimes(task.id)}
                                >
                                  ⏱ {logged ? `${logged}h` : '—'}
                                </button>
                              </>
                            )
                          })()}
                          <button
                            type="button"
                            className="danger"
                            title="Delete task"
                            onClick={() => removeTask(person.id, task)}
                          >
                            ✕
                          </button>
                        </div>
                        <div className="task-row">
                          <select
                            className="task-select"
                            value={task.sprintId}
                            title="Sprint"
                            onChange={(e) => updateTask(person.id, task.id, { sprintId: e.target.value })}
                          >
                            <option value={BACKLOG}>Backlog</option>
                            {sprints.map((sprint, i) => (
                              <option key={sprint.id} value={sprint.id}>
                                {sprintLabel(sprint, i)}
                              </option>
                            ))}
                          </select>
                          <select
                            className="task-select"
                            value={person.id}
                            title="Assigned to"
                            onChange={(e) => reassign(task.id, e.target.value)}
                          >
                            {people.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name.trim() || 'unnamed'}
                              </option>
                            ))}
                          </select>
                          <input
                            className="cell-input task-notes"
                            value={task.notes}
                            placeholder="notes — blockers, links, next step"
                            onChange={(e) => updateTask(person.id, task.id, { notes: e.target.value })}
                          />
                        </div>
                        {openTimes.has(task.id) && (
                          <div className="time-entries">
                            {task.entries.map((entry) => (
                              <div className="time-entry" key={entry.id}>
                                <input
                                  type="datetime-local"
                                  value={toLocalInput(entry.start)}
                                  title="Started"
                                  onChange={(e) =>
                                    updateEntry(person, task, entry.id, {
                                      start: fromLocalInput(e.target.value)
                                    })
                                  }
                                />
                                <input
                                  type="datetime-local"
                                  value={toLocalInput(entry.end)}
                                  title={entry.end ? 'Finished' : 'Still running'}
                                  onChange={(e) =>
                                    updateEntry(person, task, entry.id, {
                                      end: fromLocalInput(e.target.value)
                                    })
                                  }
                                />
                                <input
                                  className="cell-input"
                                  value={entry.note}
                                  placeholder="what this stretch was"
                                  onChange={(e) =>
                                    updateEntry(person, task, entry.id, { note: e.target.value })
                                  }
                                />
                                <span className="entry-hours">
                                  {entry.end ? `${entryHours(entry)}h` : 'running'}
                                </span>
                                <button
                                  type="button"
                                  className="danger"
                                  title="Delete this time entry"
                                  onClick={() => removeEntry(person, task, entry.id)}
                                >
                                  ✕
                                </button>
                              </div>
                            ))}
                            <div className="time-entry-foot">
                              <button type="button" className="add-task" onClick={() => addEntry(person, task)}>
                                + Add time entry
                              </button>
                              <span className="muted">
                                {task.entries.length} entr{task.entries.length === 1 ? 'y' : 'ies'} ·{' '}
                                {trackedHours(task, now)}h logged
                              </span>
                            </div>
                          </div>
                        )}

                      </li>
                    ))}
                  </ul>
                )}

                {hidden > 0 && (
                  <button
                    type="button"
                    className="more-tasks"
                    onClick={() => setFocusId(person.id)}
                    title={`Show all ${tasks.length} of their tasks`}
                  >
                    ⤢ {hidden} more task(s) — expand
                  </button>
                )}

                <button type="button" className="add-task" onClick={() => addTask(person)}>
                  + Add task
                  {selected ? ` to ${sprintLabel(selected, selectedIndex)}` : ''}
                </button>
              </section>
            )
            }
          )}
        </div>
      )}

      {seating && (
        <AddPerson
          people={people}
          onAdd={seatPerson}
          onClose={() => setSeating(false)}
        />
      )}

      {mailing && <PlanningSummaryDialog mode="standup" onClose={() => setMailing(false)} />}

      {adding && (
        <AddTasks
          people={people}
          sprints={sprints}
          sprintId={view.sprintId === null ? BACKLOG : view.sprintId}
          onAdd={addTasks}
          onClose={() => setAdding(false)}
        />
      )}


      {people.length > 0 && (
        <div className="grid-footer">
          <button type="button" onClick={() => setSeating(true)}>
            + Add person
          </button>
          <span className="muted">
            {view.sprintId === null
              ? 'Every sprint'
              : selected
                ? `${sprintLabel(selected, selectedIndex)} · ${sprintRange(selected)}`
                : 'Backlog'}{' '}
            · {visible.reduce((n, v) => n + v.tasks.length, 0)} of {stats.tasks} task(s) ·{' '}
            {visible.length} of {people.length} people
            {focusId && (
              <>
                {' · '}
                <button type="button" className="link" onClick={() => setFocusId(null)}>
                  back to the whole board
                </button>
              </>
            )}
          </span>
        </div>
      )}
    </>
  )
}

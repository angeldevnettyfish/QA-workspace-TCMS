import React from 'react'
import { useEffect, useMemo, useState } from 'react'
import TaskEmailDialog from './TaskEmailDialog'
import {
  SCRUM_STATUSES,
  TEST_RESULTS,
  BACKLOG,
  activeTimeEntries,
  blankEntry,
  entryHours,
  fromLocalInput,
  hours,
  isRunning,
  moveTask,
  newId,
  sprintLabel,
  spentHours,
  startTaskFor,
  stopTaskFor,
  toLocalInput,
  todayISO,
  touchTask
} from '../lib/scrum'
import { useScrum } from '../lib/scrumState'

const slug = (s) => String(s).toLowerCase().replace(/\s+/g, '-')
const resultClass = (r) => `pill result-${slug(r)}`
const formatClock = (h) => {
  const total = Math.round((h || 0) * 60)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}
const timeStamp = (value) => value ? new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—'

/**
 * One task opened full-size, laid out like a ticket: a wide area on the left for
 * the description, the tester's write-up and the time log, and a Task Info
 * column on the right for the short facts. Every field saves as it is typed,
 * the same way the board does, so there is nothing to submit.
 */
export default function TaskDialog({ taskId, onClose }) {
  const { people, setPeople, sprints } = useScrum()
  const found = useMemo(() => {
    for (const person of people) {
      const task = person.tasks.find((t) => t.id === taskId)
      if (task) return { person, task }
    }
    return null
  }, [people, taskId])

  const [logDate, setLogDate] = useState(todayISO)
  const [logStart, setLogStart] = useState('09:00')
  const [logEnd, setLogEnd] = useState('')
  const [logNote, setLogNote] = useState('')
  const [timeMemberId, setTimeMemberId] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const [showTime, setShowTime] = useState(false)
  const [emailOpen, setEmailOpen] = useState(false)
  const [editingEntryId, setEditingEntryId] = useState('')
  const [entryDraft, setEntryDraft] = useState(null)
  const [entryEditError, setEntryEditError] = useState('')

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !emailOpen && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [emailOpen, onClose])

  const activeMemberId = found && people.some((p) => p.id === timeMemberId) ? timeMemberId : found?.person.id || ''
  const running = found ? isRunning(found.task, activeMemberId) : false
  useEffect(() => {
    if (!running) return undefined
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])

  if (!found) return null
  const { person, task } = found
  const timeEntries = activeTimeEntries(task)

  const update = (patch) =>
    setPeople((list) =>
      list.map((p) =>
        p.id === person.id
          ? { ...p, tasks: p.tasks.map((t) => (t.id === task.id ? touchTask(t, patch) : t)) }
          : p
      )
    )
  const updateTesting = (patch) => update({ ...patch, testedAt: new Date().toISOString() })
  const setEntries = (entries) => update({ entries })
  const patchEntry = (id, patch) =>
    setEntries(task.entries.map((e) => (e.id === id ? { ...e, ...patch, updatedAt: new Date().toISOString() } : e)))

  const editEntry = (entry) => {
    setEditingEntryId(entry.id)
    setEntryDraft({ start: toLocalInput(entry.start), end: toLocalInput(entry.end), note: entry.note || '' })
    setEntryEditError('')
  }
  const saveEntryEdit = (entry) => {
    const start = fromLocalInput(entryDraft?.start)
    const end = fromLocalInput(entryDraft?.end)
    if (!start) return setEntryEditError('Enter a valid start time.')
    if (entry.end && !end) return setEntryEditError('Use Resume to start a new timer.')
    if (end && new Date(end) <= new Date(start)) return setEntryEditError('End time must be after start time.')
    patchEntry(entry.id, { start, end, note: entryDraft.note })
    setEditingEntryId('')
    setEntryDraft(null)
    setEntryEditError('')
  }
  const cancelEntryEdit = () => {
    setEditingEntryId('')
    setEntryDraft(null)
    setEntryEditError('')
  }
  const resumeEntry = (entry) => {
    const memberId = entry.memberId || person.id
    setTimeMemberId(memberId)
    setPeople((list) => startTaskFor(list, memberId, task.id))
  }
  const stopEntry = (entry) => setPeople((list) => stopTaskFor(list, entry.memberId || person.id, task.id))

  const logStartAt = logDate && logStart ? new Date(`${logDate}T${logStart}:00`) : null
  const logEndAt = logDate && logEnd ? new Date(`${logDate}T${logEnd}:00`) : null
  const logValid = Boolean(logStartAt && logEndAt && logEndAt > logStartAt)
  const logHours = logValid ? Math.round(((logEndAt - logStartAt) / 3600000) * 100) / 100 : 0

  const logTime = () => {
    if (!logValid) return
    setEntries([
      ...task.entries,
      { ...blankEntry(), id: newId('en'), memberId: activeMemberId, start: logStartAt.toISOString(), end: logEndAt.toISOString(), note: logNote.trim(), updatedAt: new Date().toISOString() }
    ])
    // The next stretch usually starts where this one ended.
    setLogStart(logEnd)
    setLogEnd('')
    setLogNote('')
  }

  const stop = () => setPeople((list) => stopTaskFor(list, activeMemberId, task.id))

  const spent = spentHours(task, now)
  const diff = task.estimate ? Math.round((spent - task.estimate) * 100) / 100 : null
  const sprintOptions = [
    { id: BACKLOG, label: 'Backlog' },
    ...sprints.map((s, i) => ({ id: s.id, label: sprintLabel(s, i) }))
  ]

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal task-dialog" role="dialog" aria-modal="true" aria-label="Task details">
        <header className="td-head">
          <div className="td-title">
            <div className="td-title-row">
              <input
                className="td-title-input"
                value={task.title}
                placeholder="Untitled task"
                aria-label="Task title"
                onChange={(e) => update({ title: e.target.value })}
              />
              <span className={`pill ${slug(task.status)}`}>{task.status}</span>
              <span className={resultClass(task.testResult)}>{task.testResult}</span>
            </div>
            <p className="td-sub">
              {person.name.trim() || 'Unassigned'} · {sprintOptions.find((o) => o.id === task.sprintId)?.label || 'Backlog'}
            </p>
          </div>
          <button type="button" className="close td-close" onClick={onClose} title="Close">
            ✕
          </button>
        </header>

        <div className="td-layout">
          <div className="td-main">
            <div className="td-toolbar">
              <label className="td-time-member">Working as
                <select value={activeMemberId} onChange={(e) => setTimeMemberId(e.target.value)}>
                  {people.map((member) => <option key={member.id} value={member.id}>{member.name.trim() || 'unnamed'}</option>)}
                </select>
              </label>
              {running ? (
                <button type="button" onClick={stop}>
                  ⏹ Stop timer
                </button>
              ) : (
                <button type="button" onClick={() => setPeople((list) => startTaskFor(list, activeMemberId, task.id))}>
                  ▶ Start timer
                </button>
              )}
              <button
                type="button"
                className={`td-time-toggle${showTime ? ' on' : ''}`}
                aria-expanded={showTime}
                title={showTime ? 'Hide the time log' : 'Log time and see the time spent'}
                onClick={() => setShowTime((v) => !v)}
              >
                ⏱ Log time · {Math.round(spent * 100) / 100} h {showTime ? '▴' : '▾'}
              </button>
              <button type="button" onClick={() => setEmailOpen(true)} title="Email this task to its owner and contributors">
                ✉ Email
              </button>
            </div>

            {showTime && (
            <section className="td-block td-time">
              <h3>
                Time spent
                <small>
                  {Math.round(spent * 100) / 100} h{task.estimate ? ` of ${task.estimate} h estimated` : ''}
                  {diff !== null && diff !== 0 ? ` (${diff > 0 ? '+' : ''}${diff} h)` : ''}
                </small>
              </h3>
              <div className="td-log">
                <label>
                  Date
                  <input type="date" value={logDate} onChange={(e) => setLogDate(e.target.value)} />
                </label>
                <label>
                  Start time
                  <input type="time" value={logStart} onChange={(e) => setLogStart(e.target.value)} />
                </label>
                <label>
                  End time
                  <input type="time" value={logEnd} onChange={(e) => setLogEnd(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && logTime()} />
                </label>
                <label className="td-log-hours">
                  Hours
                  <input readOnly tabIndex={-1} value={logValid ? logHours : '—'} aria-label="Hours" />
                </label>
                <label className="grow">
                  Note
                  <input value={logNote} placeholder="what was done" onChange={(e) => setLogNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && logTime()} />
                </label>
                <button type="button" className="primary" disabled={!logValid} title={logEnd && !logValid ? 'End time must be after the start time' : undefined} onClick={logTime}>
                  + Log time
                </button>
              </div>

              {timeEntries.length > 0 ? (
                <div className="td-entries-wrap">
                  <table className="td-entries">
                    <thead>
                      <tr>
                        <th>Start</th>
                        <th>End</th>
                        <th>Person</th>
                        <th>Hours</th>
                        <th>Note</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {timeEntries.map((e) => (
                        <tr key={e.id} className={editingEntryId === e.id ? 'editing' : undefined}>
                          <td>
                            {editingEntryId === e.id ? (
                              <input type="datetime-local" aria-label="Edit start time" value={entryDraft?.start || ''} onChange={(ev) => setEntryDraft((draft) => ({ ...draft, start: ev.target.value }))} />
                            ) : timeStamp(e.start)}
                          </td>
                          <td>
                            {editingEntryId === e.id ? (
                              <input type="datetime-local" aria-label="Edit end time" value={entryDraft?.end || ''} onChange={(ev) => setEntryDraft((draft) => ({ ...draft, end: ev.target.value }))} />
                            ) : (
                              e.end ? timeStamp(e.end) : <span className="muted">running…</span>
                            )}
                          </td>
                          <td>
                            {people.find((member) => member.id === e.memberId)?.name.trim() || person.name.trim() || 'Unassigned'}
                          </td>
                          <td>{entryHours(e, now)}</td>
                          <td>
                            {editingEntryId === e.id ? (
                              <input aria-label="Edit time entry note" value={entryDraft?.note || ''} placeholder="note" onChange={(ev) => setEntryDraft((draft) => ({ ...draft, note: ev.target.value }))} />
                            ) : (e.note || '—')}
                          </td>
                          <td className="td-entry-actions">
                          <div className="td-entry-action-buttons">
                            {editingEntryId === e.id ? (
                              <>
                                <button type="button" className="primary small" onClick={() => saveEntryEdit(e)}>Save</button>
                                <button type="button" className="small" onClick={cancelEntryEdit}>Cancel</button>
                              </>
                            ) : (
                              <>
                                <button type="button" className="small" onClick={() => editEntry(e)}>Edit</button>
                                {e.end ? (
                                  <button type="button" className="small" title="Start a new timer for this person on this task" onClick={() => resumeEntry(e)}>▶ Resume</button>
                                ) : (
                                  <button type="button" className="small" title="Stop this person's timer" onClick={() => stopEntry(e)}>⏹ Stop</button>
                                )}
                                <button type="button" className="danger small" title="Delete this entry" onClick={() => setEntries(task.entries.map((x) => {
                                  if (x.id !== e.id) return x
                                  const at = new Date().toISOString()
                                  return { ...x, deletedAt: at, updatedAt: at }
                                }))}>✕</button>
                              </>
                            )}
                          </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <label className="td-manual">
                  No time entries yet — or type the total spent so far:
                  <input type="number" min="0" step="0.25" value={task.spent || ''} placeholder="hours" onChange={(e) => update({ spent: hours(e.target.value) })} />
                </label>
              )}
              {entryEditError && <p className="td-edit-error" role="alert">{entryEditError}</p>}
            </section>
            )}

            <section className="td-block">
              <h3>Description</h3>
              <textarea
                className="td-area"
                rows={4}
                value={task.notes}
                placeholder="Describe the task: blockers, links, next step…"
                onChange={(e) => update({ notes: e.target.value })}
              />
            </section>

            <section className="td-block">
              <h3>
                Test details &amp; results
                {task.testedAt && <small>updated {new Date(task.testedAt).toLocaleString()}</small>}
              </h3>
              <textarea
                className="td-area td-area-big"
                rows={12}
                value={task.testDetails}
                placeholder="Steps performed, what was observed, expected vs actual, evidence links…"
                onChange={(e) => updateTesting({ testDetails: e.target.value })}
              />
              <div className="td-pair">
                <label>
                  Environment / build
                  <input value={task.environment} placeholder="e.g. QA · v1.4.2 · Chrome" onChange={(e) => update({ environment: e.target.value })} />
                </label>
                <label>
                  Defect IDs / links
                  <input value={task.defects} placeholder="e.g. BUG-101, BUG-102" onChange={(e) => update({ defects: e.target.value })} />
                </label>
              </div>
            </section>

          </div>

          <aside className="td-side">
            <section className="td-side-block">
              <h3>Task Info</h3>
              <dl className="td-info">
                <div>
                  <dt>Status</dt>
                  <dd>
                    <select value={task.status} onChange={(e) => update({ status: e.target.value })}>
                      {SCRUM_STATUSES.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </dd>
                </div>
                <div>
                  <dt>Result</dt>
                  <dd>
                    <select className={resultClass(task.testResult)} value={task.testResult} onChange={(e) => updateTesting({ testResult: e.target.value })}>
                      {TEST_RESULTS.map((r) => (
                        <option key={r}>{r}</option>
                      ))}
                    </select>
                  </dd>
                </div>
                <div>
                  <dt>Issues entered</dt>
                  <dd>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={task.issues || ''}
                      placeholder="0"
                      title="How many issues were entered against this task"
                      onChange={(e) => update({ issues: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                    />
                  </dd>
                </div>
                <div>
                  <dt>Test cases</dt>
                  <dd>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={task.testCases || ''}
                      placeholder="0"
                      title="How many test cases this task covers"
                      onChange={(e) => update({ testCases: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                    />
                  </dd>
                </div>
                <div>
                  <dt>Automated</dt>
                  <dd>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      max={task.testCases || undefined}
                      value={task.automatedCases || ''}
                      placeholder="0"
                      title="How many of those test cases are automated"
                      onChange={(e) => update({ automatedCases: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                    />
                  </dd>
                </div>
                <div>
                  <dt>Sprint</dt>
                  <dd>
                    <select value={task.sprintId} onChange={(e) => update({ sprintId: e.target.value })}>
                      {sprintOptions.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </dd>
                </div>
                <div>
                  <dt>Estimated hours</dt>
                  <dd>
                    <input type="number" min="0" step="0.25" value={task.estimate || ''} placeholder="—" onChange={(e) => update({ estimate: hours(e.target.value) })} />
                  </dd>
                </div>
                <div>
                  <dt>Unplanned hours</dt>
                  <dd>
                    <input type="number" min="0" step="0.25" value={task.unplannedHours || ''} placeholder="0" onChange={(e) => update({ unplannedHours: hours(e.target.value) })} />
                  </dd>
                </div>
                <div>
                  <dt>Total logged time</dt>
                  <dd className="td-static">{formatClock(spent)}</dd>
                </div>
              </dl>
            </section>

            <section className="td-side-block">
              <h3>Assignee</h3>
              <select value={person.id} onChange={(e) => setPeople((list) => moveTask(list, task.id, e.target.value))}>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name.trim() || 'unnamed'}
                  </option>
                ))}
              </select>
              <div className="td-assignee">
                <span className="td-avatar">{(person.name.trim()[0] || '?').toUpperCase()}</span>
                <span>{person.name.trim() || 'Unassigned'}</span>
              </div>
            </section>
          </aside>
        </div>

        <footer className="td-foot">
          <span className="muted">Changes save automatically.</span>
          <button type="button" className="primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
      {emailOpen && <TaskEmailDialog task={task} owner={person} people={people} sprints={sprints} onClose={() => setEmailOpen(false)} />}
    </div>
  )
}

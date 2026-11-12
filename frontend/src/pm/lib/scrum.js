/** Where a task stands in the sprint; "To Do" is the default for a new one. */
export const SCRUM_STATUSES = ['To Do', 'In Progress', 'Blocked', 'Done']

/**
 * How the statuses stack on a card: what is being worked on sits at the top,
 * then what is stuck, then what is waiting, and finished work last.
 */
export const STATUS_ORDER = ['In Progress', 'Blocked', 'To Do', 'Done']

/** Everything that is not finished — what a standup actually talks about. */
/** The outcome of testing a task, set from the task popup. */
export const TEST_RESULTS = ['Not Run', 'Passed', 'Failed', 'Blocked']

export const OPEN_STATUSES = SCRUM_STATUSES.filter((s) => s !== 'Done')

/** A task with no sprint sits in the backlog; the picker uses the same value. */
export const BACKLOG = ''

/**
 * "Every sprint" as a stored choice. It cannot be null: null already means "no
 * choice made yet", which resolves to the sprint running today.
 */
export const ALL_SPRINTS = '__all'

const PEOPLE_KEY = 'spent-time.scrum.v1'
const SPRINTS_KEY = 'spent-time.scrum.sprints'
const VIEW_KEY = 'spent-time.scrum.view'

export const newId = (kind) =>
  `${kind}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`

export const blankTask = () => ({
  id: '',
  title: '',
  status: 'To Do',
  notes: '',
  sprintId: BACKLOG,
  // The roadmap is the product backlog: a task can point at the feature it
  // moves forward, or at nothing when it is standalone.
  featureId: '',
  // Set on every edit, so a card can show the one task that actually moved.
  updatedAt: '',
  // Set only when the notes change, so a standup can report the notes written
  // that day rather than every note ever typed.
  notesAt: '',
  // Planning numbers, in hours; 0 means "not estimated yet".
  estimate: 0,
  // Typed by hand. Once a task has time entries they are what counts, and this
  // is left alone rather than quietly overwritten.
  spent: 0,
  // Testing record, written by whoever tests the task.
  testResult: 'Not Run',
  testDetails: '',
  environment: '',
  defects: '',
  // How many issues (bugs) were entered against this task.
  issues: 0,
  // Test cases covered by this task, and how many of them are automated.
  testCases: 0,
  automatedCases: 0,
  testedAt: '',
  // Stretches of work: { id, start, end, note }. An entry with no end is
  // running now.
  entries: []
})

/** One stretch of work on a task. An open end means the clock is running. */
export const blankEntry = () => ({ id: '', start: '', end: '', note: '' })

export const normalizeEntry = (e) => ({
  ...blankEntry(),
  id: e?.id || newId('en'),
  start: typeof e?.start === 'string' ? e.start : '',
  end: typeof e?.end === 'string' ? e.end : '',
  note: String(e?.note ?? '')
})
export const blankPerson = () => ({ id: '', name: '', email: '', role: '', tasks: [], log: [] })
export const blankNote = () => ({ id: '', date: '', text: '' })
export const blankSprint = () => ({ id: '', name: '', start: '', end: '', goal: '' })

const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

/**
 * Hours, as a number that can be added up: anything unparseable or negative is
 * nothing, and a quarter of an hour is as fine as it gets.
 */
export function hours(value) {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? '').replace(',', '.'))
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.round(n * 100) / 100
}

/**
 * Dates are written with fixed English abbreviations rather than the machine
 * locale: these strings go into sprint labels and into emails read by other
 * people, and the runtime locale would otherwise render the same sprint as
 * "Sep" here and "Sept" there.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function formatDay(iso, { weekday = false, year = true } = {}) {
  const [y, m, d] = iso.split('-').map(Number)
  const parts = [String(d), MONTHS[m - 1]]
  if (year) parts.push(String(y))
  if (!weekday) return parts.join(' ')
  return `${WEEKDAYS[new Date(y, m - 1, d).getDay()]} ${parts.join(' ')}`
}

/** Local date, not UTC: a note written at 11pm belongs to that day. */
export function todayISO() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const normalizeTask = (t) => ({
  ...blankTask(),
  id: t?.id || newId('tk'),
  title: String(t?.title ?? ''),
  status: SCRUM_STATUSES.includes(t?.status) ? t.status : 'To Do',
  notes: String(t?.notes ?? ''),
  sprintId: typeof t?.sprintId === 'string' ? t.sprintId : BACKLOG,
  featureId: typeof t?.featureId === 'string' ? t.featureId : '',
  updatedAt: typeof t?.updatedAt === 'string' ? t.updatedAt : '',
  notesAt: typeof t?.notesAt === 'string' ? t.notesAt : '',
  estimate: hours(t?.estimate),
  spent: hours(t?.spent),
  testResult: TEST_RESULTS.includes(t?.testResult) ? t.testResult : 'Not Run',
  testDetails: String(t?.testDetails ?? ''),
  environment: String(t?.environment ?? ''),
  defects: String(t?.defects ?? ''),
  issues: Math.max(0, Math.floor(Number(t?.issues) || 0)),
  testCases: Math.max(0, Math.floor(Number(t?.testCases) || 0)),
  automatedCases: Math.max(0, Math.floor(Number(t?.automatedCases) || 0)),
  testedAt: typeof t?.testedAt === 'string' ? t.testedAt : '',
  entries: Array.isArray(t?.entries) ? t.entries.filter(Boolean).map(normalizeEntry) : []
})

/**
 * A datetime-local input speaks local wall-clock time; entries are stored as
 * instants. These two are the only place that conversion happens.
 */
export function toLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fromLocalInput(value) {
  if (!value) return ''
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString()
}

/** "1:05" — how long the running clock has been going. */
export function elapsedLabel(entry, now = Date.now()) {
  const hoursDecimal = entryHours(entry, now)
  const minutes = Math.max(0, Math.round(hoursDecimal * 60))
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
}

/** The entry still running on a task, if any. */
export const runningEntry = (task) => (task?.entries || []).find((e) => e.start && !e.end) || null

export const isRunning = (task) => Boolean(runningEntry(task))

/** Hours between two stamps, to the minute; an open entry runs up to `now`. */
export function entryHours(entry, now = Date.now()) {
  if (!entry?.start) return 0
  const from = Date.parse(entry.start)
  const to = entry.end ? Date.parse(entry.end) : now
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 0
  return Math.round(((to - from) / 3600000) * 100) / 100
}

/** What the timer has logged against a task, running entry included. */
export function trackedHours(task, now = Date.now()) {
  const total = (task?.entries || []).reduce((n, entry) => n + entryHours(entry, now), 0)
  return Math.round(total * 100) / 100
}

/**
 * The hours a task has actually cost. Time entries are the record once there
 * are any; the typed figure is what a task without them has to go on.
 */
export function spentHours(task, now = Date.now()) {
  return task?.entries?.length ? trackedHours(task, now) : hours(task?.spent)
}

/** Starts the clock, closing anything already running on the same task. */
export function startTimer(task, at = new Date().toISOString()) {
  const entries = (task.entries || []).map((e) => (e.start && !e.end ? { ...e, end: at } : e))
  return touchTask(task, {
    entries: [...entries, { ...blankEntry(), id: newId('en'), start: at }]
  })
}

/** Stops it. A task that was not running comes back untouched. */
export function stopTimer(task, at = new Date().toISOString()) {
  if (!isRunning(task)) return task
  return touchTask(task, {
    entries: task.entries.map((e) => (e.start && !e.end ? { ...e, end: at } : e))
  })
}

/**
 * Starting one person's task stops whatever else of theirs was running: two
 * clocks going at once for the same person is a mistake, not a feature.
 */
export function startTaskFor(people, personId, taskId, at = new Date().toISOString()) {
  return people.map((person) => {
    if (person.id !== personId) return person
    return {
      ...person,
      tasks: person.tasks.map((task) => {
        if (task.id === taskId) return startTimer(task, at)
        return isRunning(task) ? stopTimer(task, at) : task
      })
    }
  })
}

/** Stamps a task as just edited, and its notes too when those are what changed. */
export const touchTask = (task, patch = {}) => {
  const now = new Date().toISOString()
  const noteChanged = 'notes' in patch && String(patch.notes ?? '') !== String(task.notes ?? '')
  return {
    ...task,
    ...patch,
    updatedAt: now,
    notesAt: noteChanged ? now : task.notesAt || ''
  }
}

/**
 * Whether a task's note belongs to a given day. Notes written before they were
 * dated fall back to when the task was last touched, which is the closest thing
 * to a date those have.
 */
export function noteWrittenOn(task, date) {
  if (!String(task?.notes ?? '').trim()) return false
  const when = task.notesAt || task.updatedAt || ''
  return when.slice(0, 10) === date
}

/** One day's standup note for one person. */
export const normalizeNote = (n) => ({
  ...blankNote(),
  id: n?.id || newId('nt'),
  date: isDate(n?.date) ? n.date : todayISO(),
  text: String(n?.text ?? '')
})

export const normalizePerson = (p) => ({
  ...blankPerson(),
  id: p?.id || newId('pp'),
  name: String(p?.name ?? ''),
  // What ties a card to whoever signed in; the name is the fallback.
  email: String(p?.email ?? '').trim().toLowerCase(),
  role: String(p?.role ?? ''),
  tasks: Array.isArray(p?.tasks) ? p.tasks.filter(Boolean).map(normalizeTask) : [],
  log: Array.isArray(p?.log) ? p.log.filter(Boolean).map(normalizeNote) : []
})

export const normalizeSprint = (s) => ({
  ...blankSprint(),
  id: s?.id || newId('sp'),
  name: String(s?.name ?? ''),
  start: isDate(s?.start) ? s.start : '',
  end: isDate(s?.end) ? s.end : '',
  goal: String(s?.goal ?? '')
})

/** A task pointing at a sprint that was deleted falls back to the backlog. */
export function pruneSprintIds(people, sprints) {
  const live = new Set(sprints.map((s) => s.id))
  const orphan = (task) => task.sprintId && !live.has(task.sprintId)
  if (!people.some((person) => person.tasks.some(orphan))) return people
  return people.map((person) => {
    if (!person.tasks.some(orphan)) return person
    return {
      ...person,
      tasks: person.tasks.map((task) => (orphan(task) ? { ...task, sprintId: BACKLOG } : task))
    }
  })
}

/**
 * A link to a roadmap feature that has since been deleted is dropped, the same
 * way a task whose sprint is gone falls back to the backlog. Features are only
 * pruned when the roadmap is actually known: an empty list means it has not
 * loaded yet, and clearing every link then would lose the links.
 */
export function pruneFeatureIds(people, features) {
  if (!features.length) return people
  const live = new Set(features.map((f) => f.id))
  const orphan = (task) => task.featureId && !live.has(task.featureId)
  if (!people.some((person) => person.tasks.some(orphan))) return people
  return people.map((person) => {
    if (!person.tasks.some(orphan)) return person
    return {
      ...person,
      tasks: person.tasks.map((task) => (orphan(task) ? { ...task, featureId: '' } : task))
    }
  })
}

/**
 * The rows of the Add tasks form that are worth keeping: a row needs a title
 * and someone to belong to. Half-typed rows and the blank one at the bottom are
 * simply ignored, so Done never creates an untitled task.
 */
export function readyTasks(rows = []) {
  return rows
    .filter((r) => String(r?.title ?? '').trim() && r?.personId)
    .map((r) => ({
      personId: r.personId,
      title: String(r.title).trim(),
      notes: String(r.notes ?? '').trim(),
      estimate: hours(r.estimate),
      featureId: typeof r.featureId === 'string' ? r.featureId : '',
      sprintId: typeof r.sprintId === 'string' ? r.sprintId : BACKLOG
    }))
}

/**
 * A card's tasks as they are shown: In Progress always on top, and within one
 * status the order they were dragged into. Array.prototype.sort is stable, so
 * the hand-made order survives the grouping.
 */
export function sortTasks(tasks = []) {
  return [...tasks].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status))
}

/**
 * Moves a task by drag and drop: to another person, to a place in someone's
 * list, or both. Dropping on a person rather than a task appends it. The task
 * is removed from whoever holds it first, so it can never end up in two lists.
 */
export function moveTaskTo(people, taskId, toPersonId, targetTaskId = null, after = false) {
  const held = allTasks(people).find(({ task }) => task.id === taskId)
  if (!held || !people.some((p) => p.id === toPersonId)) return people
  if (targetTaskId === taskId) return people
  const moving = held.task

  const stripped = people.map((person) =>
    person.tasks.some((t) => t.id === taskId)
      ? { ...person, tasks: person.tasks.filter((t) => t.id !== taskId) }
      : person
  )

  return stripped.map((person) => {
    if (person.id !== toPersonId) return person
    const at = targetTaskId ? person.tasks.findIndex((t) => t.id === targetTaskId) : -1
    const tasks = [...person.tasks]
    if (at === -1) tasks.push(moving)
    else tasks.splice(after ? at + 1 : at, 0, moving)
    return { ...person, tasks }
  })
}

/** Notes newest first — a standup reads backwards from today. */
export const sortedLog = (person) =>
  [...(person.log || [])].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))

export const noteOn = (person, date) => sortedLog(person).find((n) => n.date === date) || null

/** "12 Sep 2026", or "today" / "yesterday" for the two days that matter most. */
export function noteDateLabel(date, on = todayISO()) {
  if (date === on) return 'today'
  const [y, m, d] = on.split('-').map(Number)
  const prev = new Date(y, m - 1, d - 1)
  const pad = (n) => String(n).padStart(2, '0')
  if (date === `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}-${pad(prev.getDate())}`) {
    return 'yesterday'
  }
  return formatDay(date)
}

export const isOpen = (task) => task.status !== 'Done'

/** A sprint is current when today falls inside its dates. */
export function isCurrentSprint(sprint, on = todayISO()) {
  if (!sprint?.start || !sprint?.end) return false
  return sprint.start <= on && on <= sprint.end
}

/** "15 Sep – 26 Sep 2026", or what is known of it. */
export function sprintRange(sprint) {
  const fmt = (iso, withYear) => formatDay(iso, { year: withYear })
  if (sprint.start && sprint.end) {
    const sameYear = sprint.start.slice(0, 4) === sprint.end.slice(0, 4)
    return `${fmt(sprint.start, !sameYear)} – ${fmt(sprint.end, true)}`
  }
  if (sprint.start) return `from ${fmt(sprint.start, true)}`
  if (sprint.end) return `until ${fmt(sprint.end, true)}`
  return 'no dates'
}

const utc = (iso) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

/** Date arithmetic in UTC, so a clock change never moves a sprint by a day. */
export function addDays(iso, days) {
  const date = utc(iso)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/**
 * ISO-8601 week number, which is the week containing that date's Thursday —
 * which is why a sprint that starts on a Thursday always sits squarely in one
 * numbered week, with no ambiguity at the turn of the year.
 */
export function isoWeek(iso) {
  const date = utc(iso)
  const day = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - day)
  const year = date.getUTCFullYear()
  const jan1 = Date.UTC(year, 0, 1)
  return { year, week: Math.ceil(((date.getTime() - jan1) / 86400000 + 1) / 7) }
}

/** "Sprint-2026-37" — the year and week the sprint starts in. */
export function sprintNameFor(startIso) {
  const { year, week } = isoWeek(startIso)
  return `Sprint-${year}-${String(week).padStart(2, '0')}`
}

/**
 * The window a new sprint should cover: Thursday to the following Wednesday,
 * starting the day after the coming Wednesday. Adding a second sprint carries
 * on from wherever the planned sprints end rather than landing on top of them.
 */
/** A sprint runs two weeks: the start day plus thirteen more. */
export const SPRINT_DAYS = 14

export function nextSprintWindow(sprints = [], on = todayISO()) {
  const daysToWednesday = (3 - utc(on).getUTCDay() + 7) % 7
  let start = addDays(on, daysToWednesday + 1)
  const lastEnd = sprints
    .map((sprint) => sprint.end)
    .filter(Boolean)
    .sort()
    .pop()
  if (lastEnd && lastEnd >= start) start = addDays(lastEnd, 1)
  return { start, end: addDays(start, SPRINT_DAYS - 1), name: sprintNameFor(start) }
}

/** A sprint with no name still needs something to call it. */
export const sprintLabel = (sprint, index) => sprint.name.trim() || `Sprint ${index + 1}`

/**
 * The sprints new work can be put into: the one running today and anything
 * still ahead. A sprint that has already ended is not offered — nobody plans
 * into last fortnight — and one without an end date cannot be ruled out, so it
 * stays.
 */
export function selectableSprints(sprints, on = todayISO()) {
  return sprints.filter((sprint) => !sprint.end || sprint.end >= on)
}

/**
 * Which sprint a new task starts in: the one being looked at if it is still
 * open, otherwise the sprint running today, otherwise the next one to start.
 * Falls back to the backlog when there is no sprint to put it in.
 */
export function defaultSprintId(sprints, viewSprintId = null, on = todayISO()) {
  const open = selectableSprints(sprints, on)
  if (viewSprintId && open.some((s) => s.id === viewSprintId)) return viewSprintId
  const current = open.find((s) => isCurrentSprint(s, on))
  if (current) return current.id
  const upcoming = open
    .filter((s) => s.start && s.start > on)
    .sort((a, b) => a.start.localeCompare(b.start))[0]
  return upcoming ? upcoming.id : open[0]?.id ?? BACKLOG
}

/**
 * Turns the planning table's stored sprint choice into the sprint to show:
 * nothing chosen means the sprint running today, ALL_SPRINTS means no filter at
 * all, and anything else is that sprint (the backlog included).
 */
export function planSprintScope(sprints, planSprintId, on = todayISO()) {
  if (planSprintId === ALL_SPRINTS) return null
  if (planSprintId === null || planSprintId === undefined) return defaultSprintId(sprints, null, on)
  return planSprintId
}

/**
 * The sprint that follows another one: the earliest one that starts after it,
 * falling back to the next in the list when dates are missing. This is what the
 * sprint review mail means by "next sprint".
 */
export function nextSprintAfter(sprints, sprintId) {
  const at = sprints.findIndex((s) => s.id === sprintId)
  if (at === -1) return null
  const from = sprints[at]
  if (from.start) {
    const later = sprints
      .filter((s) => s.id !== from.id && s.start && s.start > from.start)
      .sort((a, b) => a.start.localeCompare(b.start))
    if (later.length) return later[0]
  }
  return sprints[at + 1] || null
}

/** Whole days left in the sprint — 0 on the last day, negative once it is over. */
export function daysLeft(sprint, on = todayISO()) {
  if (!sprint?.end) return null
  return Math.round((Date.parse(sprint.end) - Date.parse(on)) / 86400000)
}

const countStatuses = (tasks) => {
  const out = { total: tasks.length, open: 0, done: 0 }
  for (const status of SCRUM_STATUSES) out[status] = 0
  for (const task of tasks) {
    out[task.status] += 1
    if (isOpen(task)) out.open += 1
    else out.done += 1
  }
  return out
}

/** Counts for one person: what they are carrying, and what is finished. */
export const personStats = (person) => countStatuses(person.tasks)

/** The same counts across a set of people, for the header. */
export function boardStats(people) {
  const stats = countStatuses(people.flatMap((p) => p.tasks))
  return { ...stats, people: people.length, tasks: stats.total }
}

/**
 * Which card belongs to whoever is signed in: their address if a card carries
 * it, otherwise their name. Returns null when nobody on the board is them —
 * being signed in does not mean having a card.
 */
export function personFor(people, session) {
  if (!session) return null
  const email = String(session.email ?? '').trim().toLowerCase()
  const byEmail = people.find((person) => person.email && person.email === email)
  if (byEmail) return byEmail
  const name = String(session.name ?? '').trim().toLowerCase()
  if (!name) return null
  return people.find((person) => person.name.trim().toLowerCase() === name) || null
}

/** Every task on the board, with the person holding it. */
export const allTasks = (people) =>
  people.flatMap((person) => person.tasks.map((task) => ({ task, person })))

/** What is in one sprint, across everyone — the burndown line of a standup. */
export function sprintStats(people, sprintId) {
  return countStatuses(allTasks(people).map(({ task }) => task).filter((t) => t.sprintId === sprintId))
}

/**
 * Moves a task to someone else, keeping it in one place: the task is removed
 * from whoever holds it and appended to the target, so a task cannot end up
 * assigned twice or vanish if the ids no longer line up.
 */
export function moveTask(people, taskId, toPersonId) {
  const held = allTasks(people).find(({ task }) => task.id === taskId)
  if (!held || !people.some((p) => p.id === toPersonId)) return people
  // Re-picking the current assignee is a no-op, not a reshuffle: hand back the
  // same array so nothing re-renders and nothing is saved.
  if (held.person.id === toPersonId) return people
  const moved = held.task
  return people.map((person) => {
    if (person.id === toPersonId) {
      if (person.tasks.some((t) => t.id === taskId)) return person
      return { ...person, tasks: [...person.tasks, moved] }
    }
    if (!person.tasks.some((t) => t.id === taskId)) return person
    return { ...person, tasks: person.tasks.filter((t) => t.id !== taskId) }
  })
}

/* ------------------------------------------------------------------ *
 * Many tasks at once
 * ------------------------------------------------------------------ */

/**
 * The same change on every task named, wherever it sits and whoever holds it.
 * One pass over the board, so a change to forty tasks is one write and not
 * forty — and each one is stamped as if it had been edited by hand, because it
 * has been.
 */
export function patchTasks(people, ids, patch) {
  const wanted = new Set(ids)
  if (!wanted.size) return people
  return people.map((person) =>
    person.tasks.some((task) => wanted.has(task.id))
      ? {
          ...person,
          tasks: person.tasks.map((task) => (wanted.has(task.id) ? touchTask(task, patch) : task))
        }
      : person
  )
}

/** Handing a pile of tasks to one person, the move the board makes one by one. */
export const moveTasks = (people, ids, toPersonId) =>
  ids.reduce((list, id) => moveTask(list, id, toPersonId), people)

/** Dropping a pile of tasks. Anyone holding none of them is left alone. */
export function removeTasks(people, ids) {
  const wanted = new Set(ids)
  if (!wanted.size) return people
  return people.map((person) =>
    person.tasks.some((task) => wanted.has(task.id))
      ? { ...person, tasks: person.tasks.filter((task) => !wanted.has(task.id)) }
      : person
  )
}

/**
 * Which tasks an edit made on one row lands on. A row that is itself part of a
 * selection speaks for the whole of it — picking three tasks and setting one
 * of them to In Progress means all three. A row outside the selection, or a
 * selection of one, speaks only for itself, so an ordinary edit stays
 * ordinary.
 */
export function editScope(markedIds = [], taskId) {
  const ids = markedIds.filter(Boolean)
  return ids.length > 1 && ids.includes(taskId) ? ids : [taskId]
}

/**
 * What a Shift+click picks: everything between the row ticked last and the one
 * just clicked, in the order they are on screen. Either end missing — a row
 * filtered away since, say — means the run cannot be measured, so only the
 * clicked row is taken.
 */
export function rowRun(ids, from, to) {
  const start = ids.indexOf(from)
  const end = ids.indexOf(to)
  if (start < 0 || end < 0) return to ? [to] : []
  return ids.slice(Math.min(start, end), Math.max(start, end) + 1)
}

/** Which people and tasks the sprint picker, search box and chips leave visible. */
export function filterBoard(
  people,
  { query = '', statuses = new Set(), hideDone = false, sprintId = null } = {}
) {
  const q = query.trim().toLowerCase()
  const scoped = sprintId !== null
  const filtering = Boolean(q) || statuses.size > 0 || hideDone || scoped
  return people
    .map((person) => {
      const personMatches = q
        ? `${person.name} ${person.role} ${(person.log || []).map((n) => n.text).join(' ')}`
            .toLowerCase()
            .includes(q)
        : false
      const tasks = person.tasks.filter((task) => {
        if (scoped && task.sprintId !== sprintId) return false
        if (hideDone && !isOpen(task)) return false
        if (statuses.size && !statuses.has(task.status)) return false
        // A search for a name keeps that person's tasks, not just matching titles.
        if (q && !personMatches && !`${task.title} ${task.notes}`.toLowerCase().includes(q)) {
          return false
        }
        return true
      })
      return { person, tasks, personMatches }
    })
    .filter(({ person, tasks, personMatches }) => {
      if (!filtering) return true
      if (tasks.length) return true
      // Keep the card while it is only the sprint narrowing things down, so a
      // person with nothing in this sprint can still be given work.
      if (personMatches) return true
      return !q && !statuses.size && !hideDone
    })
}

/**
 * Every task of one sprint as a flat list — person by person, each person's
 * tasks in board order — which is what planning needs: one row per piece of
 * work, regardless of whose card it sits on.
 */
export function planningRows(people, sprintId = null, { hideDone = false, personId = '' } = {}) {
  return people
    .filter((person) => !personId || person.id === personId)
    .flatMap((person) =>
      sortTasks(person.tasks)
        .filter((task) => sprintId === null || task.sprintId === sprintId)
        .filter((task) => !hideDone || isOpen(task))
        .map((task) => ({ person, task }))
    )
}

/** Estimated against spent for a set of rows, with the counts that frame it. */
export function timeTotals(rows = [], now = Date.now()) {
  const totals = { tasks: rows.length, open: 0, done: 0, estimate: 0, spent: 0, estimated: 0, issues: 0 }
  for (const { task } of rows) {
    if (isOpen(task)) totals.open += 1
    else totals.done += 1
    if (task.estimate > 0) totals.estimated += 1
    totals.estimate += task.estimate
    totals.issues += task.issues || 0
    totals.spent += spentHours(task, now)
  }
  totals.estimate = Math.round(totals.estimate * 100) / 100
  totals.spent = Math.round(totals.spent * 100) / 100
  // Positive means it took longer than planned.
  totals.diff = Math.round((totals.spent - totals.estimate) * 100) / 100
  return totals
}

/**
 * The pivot at the foot of the planning table: one line per group with its
 * estimated and spent hours. `by` decides the grouping — a person, a status, a
 * roadmap feature — and empty groups are left out.
 */
export function pivotRows(rows, by) {
  const groups = new Map()
  for (const row of rows) {
    const { key, label } = by(row)
    if (!groups.has(key)) groups.set(key, { key, label, rows: [] })
    groups.get(key).rows.push(row)
  }
  return [...groups.values()].map((group) => ({
    key: group.key,
    label: group.label,
    ...timeTotals(group.rows)
  }))
}

export const byPerson = ({ person }) => ({
  key: person.id,
  label: person.name.trim() || 'unnamed'
})

export const byStatus = ({ task }) => ({ key: task.status, label: task.status })

/** The columns the planning table can be sorted by. */
export const PLAN_SORTS = ['person', 'task', 'status', 'sprint', 'roadmap', 'estimate', 'spent', 'result', 'issues']

/**
 * Sorts the planning table by one column. Status sorts by where it sits in the
 * workflow rather than alphabetically — In Progress before To Do, as on the
 * board — and the sort is stable, so rows that tie keep their board order.
 * `sprintOf` and `featureOf` name those two columns, since the row itself only
 * holds ids.
 */
export function sortPlanningRows(rows, key, dir = 'asc', { sprintOf, featureOf } = {}) {
  if (!PLAN_SORTS.includes(key)) return rows
  const sign = dir === 'desc' ? -1 : 1
  const text = (value) => String(value ?? '').trim().toLowerCase()
  const value = (row) => {
    switch (key) {
      case 'person':
        return text(row.person.name)
      case 'task':
        return text(row.task.title)
      case 'status':
        return STATUS_ORDER.indexOf(row.task.status)
      case 'sprint':
        return text(sprintOf ? sprintOf(row.task.sprintId) : row.task.sprintId)
      case 'roadmap':
        return text(featureOf ? featureOf(row.task.featureId) : row.task.featureId)
      case 'estimate':
        return row.task.estimate
      case 'result':
        return TEST_RESULTS.indexOf(row.task.testResult)
      case 'issues':
        return row.task.issues
      default:
        return spentHours(row.task)
    }
  }

  return [...rows].sort((a, b) => {
    const left = value(a)
    const right = value(b)
    if (typeof left === 'number' && typeof right === 'number') return (left - right) * sign
    // An empty cell has nothing to compare, so it goes to the bottom either way.
    if (left === '' && right !== '') return 1
    if (right === '' && left !== '') return -1
    return left.localeCompare(right) * sign
  })
}

/** The view preferences for this page; stored next to the roadmap's own. */
export function normalizeScrumView(raw) {
  const statuses = Array.isArray(raw?.statuses)
    ? raw.statuses.filter((s) => SCRUM_STATUSES.includes(s))
    : []
  return {
    hideDone: raw?.hideDone === true,
    statuses,
    // null is "every sprint"; '' is the backlog; anything else is a sprint id.
    sprintId: raw?.sprintId === null || typeof raw?.sprintId === 'string' ? raw.sprintId : null,
    // Who the standup mail goes to besides the board, so the list is not
    // retyped every morning.
    emailTo: typeof raw?.emailTo === 'string' ? raw.emailTo : '',
    // And who on the board is deliberately left off it. Everyone is a recipient
    // by default, so what has to be remembered is the exceptions — that way a
    // new joiner is included without anyone editing this list.
    emailSkip: typeof raw?.emailSkip === 'string' ? raw.emailSkip : '',
    // The planning table's own sprint and grouping, kept separately so the two
    // views can look at different sprints at once.
    planSprintId:
      raw?.planSprintId === null || typeof raw?.planSprintId === 'string' ? raw.planSprintId : null,
    planGroupBy: raw?.planGroupBy === 'status' ? 'status' : 'person',
    planHideDone: raw?.planHideDone === true,
    // '' is everyone; otherwise the one person the planning table is narrowed to.
    planPersonId: typeof raw?.planPersonId === 'string' ? raw.planPersonId : '',
    // Fixora keeps its own sprint too, so triaging last sprint's mail does not
    // drag the board and the planning table along with it.
    fixoraSprintId:
      raw?.fixoraSprintId === null || typeof raw?.fixoraSprintId === 'string'
        ? raw.fixoraSprintId
        : null,
    // Who signs the mail, so it is not retyped every fortnight.
    emailSignature: typeof raw?.emailSignature === 'string' ? raw.emailSignature : ''
  }
}

/**
 * Same reasoning as the roadmap: the board is typed in by hand, so a browser
 * copy is kept as a fallback and every read is defensive.
 */
export function loadPeople() {
  try {
    const raw = localStorage.getItem(PEOPLE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter(Boolean).map(normalizePerson) : []
  } catch {
    return []
  }
}

export function savePeople(people) {
  try {
    localStorage.setItem(PEOPLE_KEY, JSON.stringify(people))
    return true
  } catch {
    return false
  }
}

export function loadSprints() {
  try {
    const raw = localStorage.getItem(SPRINTS_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter(Boolean).map(normalizeSprint) : []
  } catch {
    return []
  }
}

export function saveSprints(sprints) {
  try {
    localStorage.setItem(SPRINTS_KEY, JSON.stringify(sprints))
    return true
  } catch {
    return false
  }
}

export function loadScrumView() {
  try {
    const raw = localStorage.getItem(VIEW_KEY)
    return normalizeScrumView(raw ? JSON.parse(raw) : null)
  } catch {
    return normalizeScrumView(null)
  }
}

export function saveScrumView(view) {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(normalizeScrumView(view)))
  } catch {
    /* the board still works, the choice just will not survive a reload */
  }
}

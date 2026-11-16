import { blankPerson, blankTask, hours, newId, spentHours } from './scrum'

/**
 * The Overview's sprint tracker (sprints and their tasks from the CSV import or
 * the Add task form) and the Scrum / Planning board are two stores. This keeps
 * them showing the same work for the tasks they share, so "Sprint 23 - Demo"
 * reads the same on both pages.
 *
 * A board task that came from the tracker carries `trackerId` and `trackerBase`,
 * a fingerprint of the shared fields as they were at the last sync. Comparing
 * it with both sides says who changed what:
 *   - only the board changed   → the change is sent to the tracker,
 *   - only the tracker changed → the board takes it,
 *   - both changed             → the tracker wins.
 */

const TO_BOARD = { completed: 'Done', closed: 'Done', 'in progress': 'In Progress', blocked: 'Blocked' }
const TO_TRACKER = { Done: 'Completed', 'In Progress': 'In Progress', Blocked: 'Blocked', 'To Do': 'Not Started' }
const mapStatus = (status) => TO_BOARD[String(status || '').trim().toLowerCase()] || 'To Do'

const key = (text) => String(text || '').trim().toLowerCase()
const owner = (name) => String(name || '').trim() || 'Unassigned'

/** The fields both sides show, in the board's terms. */
const fieldsOfItem = (item) => ({
  title: String(item.task || '').trim(),
  status: mapStatus(item.status),
  estimate: hours(item.estimated_hours),
  spent: hours(item.actual_hours),
  issues: Math.max(0, Math.floor(Number(item.defects) || 0)),
  testCases: Math.max(0, Math.floor(Number(item.test_cases) || 0)),
  environment: String(item.release || '').trim(),
  tester: owner(item.tester)
})

/** The title on the board is "S23-01 · Task"; the tracker keeps the two apart. */
const bareTitle = (title) => String(title || '').replace(/^\S+ · /, '').trim()

const fieldsOfTask = (task, person) => ({
  title: bareTitle(task.title),
  status: task.status,
  estimate: hours(task.estimate),
  spent: round(spentHours(task)),
  issues: task.issues || 0,
  testCases: task.testCases || 0,
  environment: String(task.environment || '').trim(),
  tester: owner(person.name)
})

const round = (n) => Math.round((n || 0) * 100) / 100
const sig = (fields) => JSON.stringify([fields.title, fields.status, fields.estimate, fields.spent, fields.issues, fields.testCases, fields.environment, fields.tester])

/** Earliest and latest dates of a sprint's tasks, as the sprint's own dates. */
function sprintWindow(items) {
  const starts = items.map((i) => i.start_date).filter(Boolean).sort()
  const ends = items.map((i) => i.end_date).filter(Boolean).sort()
  return { start: starts[0] || '', end: ends[ends.length - 1] || starts[starts.length - 1] || '' }
}

const ITEM_KEYS = [
  'item_id', 'start_date', 'task', 'activity', 'tester', 'priority', 'estimated_hours', 'actual_hours',
  'completion_percent', 'end_date', 'status', 'impediment', 'release', 'unplanned_hours', 'test_cases', 'defects', 'comment'
]

/** The tracker row with the board's values laid over it, ready to PUT. */
function itemBody(item, fields) {
  const body = Object.fromEntries(ITEM_KEYS.map((k) => [k, item[k] ?? null]))
  body.task = fields.title
  body.tester = fields.tester === 'Unassigned' ? '' : fields.tester
  body.status = TO_TRACKER[fields.status] || 'Not Started'
  body.estimated_hours = fields.estimate || null
  body.actual_hours = fields.spent || null
  body.defects = fields.issues || null
  body.test_cases = fields.testCases || null
  body.release = fields.environment
  if (fields.status === 'Done') body.completion_percent = 100
  return body
}

export function reconcileTracker(people, sprints, trackerSprints, itemsBySprint) {
  let nextPeople = people
  let nextSprints = sprints
  let changed = false
  const pushes = []

  const itemsById = new Map()
  for (const sprint of trackerSprints)
    for (const item of itemsBySprint[sprint.id] || []) if (!item.archived) itemsById.set(`ri_${item.id}`, { item, sprint })

  const ensurePerson = (name) => {
    let person = nextPeople.find((p) => key(p.name) === key(name))
    if (!person) {
      person = { ...blankPerson(), id: newId('pp'), name }
      nextPeople = [...nextPeople, person]
    }
    return person
  }
  const patchTask = (personId, taskId, patch) => {
    nextPeople = nextPeople.map((p) =>
      p.id === personId ? { ...p, tasks: p.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)) } : p
    )
  }

  // ---- tasks already on the board
  const onBoard = new Set()
  for (const person of people) {
    for (const task of person.tasks) {
      if (!task.trackerId) continue
      const entry = itemsById.get(task.trackerId)
      if (!entry) continue // removed or archived in the tracker: leave the board copy alone
      onBoard.add(task.trackerId)
      const { item } = entry
      const theirs = fieldsOfItem(item)
      const mine = fieldsOfTask(task, person)
      const base = task.trackerBase
      const tracker = sig(theirs)
      const board = sig(mine)
      if (tracker === board) {
        if (base !== board) {
          patchTask(person.id, task.id, { trackerBase: board })
          changed = true
        }
      } else if (base && board !== base && tracker === base) {
        pushes.push({ itemId: item.id, body: itemBody(item, mine) }) // only the board changed
        patchTask(person.id, task.id, { trackerBase: board })
        changed = true
      } else {
        // the tracker changed (or this is the first look): the board takes it
        const code = item.item_id ? `${item.item_id} · ` : ''
        const patch = {
          title: `${code}${theirs.title}`,
          status: theirs.status,
          estimate: theirs.estimate,
          issues: theirs.issues,
          testCases: theirs.testCases,
          environment: theirs.environment,
          trackerBase: tracker
        }
        if (!task.entries.length) patch.spent = theirs.spent
        if (key(theirs.tester) !== key(person.name)) {
          // a different tester: the task moves to their card
          const target = ensurePerson(theirs.tester)
          nextPeople = nextPeople.map((p) => (p.id === person.id ? { ...p, tasks: p.tasks.filter((t) => t.id !== task.id) } : p))
          nextPeople = nextPeople.map((p) => (p.id === target.id ? { ...p, tasks: [...p.tasks, { ...task, ...patch }] } : p))
        } else {
          patchTask(person.id, task.id, patch)
        }
        changed = true
      }
    }
  }

  // ---- tracker tasks not on the board yet
  for (const trackerSprint of trackerSprints) {
    const items = (itemsBySprint[trackerSprint.id] || []).filter((item) => !item.archived)
    const fresh = items.filter((item) => !onBoard.has(`ri_${item.id}`))
    if (!fresh.length) continue

    let sprint = nextSprints.find((s) => key(s.name) === key(trackerSprint.name))
    if (!sprint) {
      const window = sprintWindow(items)
      sprint = { id: newId('sp'), name: trackerSprint.name, start: window.start, end: window.end, goal: '' }
      nextSprints = [...nextSprints, sprint]
    }
    for (const item of fresh) {
      const fields = fieldsOfItem(item)
      const person = ensurePerson(fields.tester)
      const code = item.item_id ? `${item.item_id} · ` : ''
      const task = {
        ...blankTask(),
        id: newId('tk'),
        trackerId: `ri_${item.id}`,
        title: `${code}${fields.title}`,
        status: fields.status,
        notes: [item.comment, item.impediment && `Impediment: ${item.impediment}`].filter(Boolean).join('\n'),
        sprintId: sprint.id,
        estimate: fields.estimate,
        spent: fields.spent,
        issues: fields.issues,
        testCases: fields.testCases,
        environment: fields.environment,
        testResult: fields.status === 'Done' ? 'Passed' : fields.status === 'Blocked' ? 'Blocked' : 'Not Run',
        updatedAt: new Date().toISOString(),
        trackerBase: sig(fields)
      }
      nextPeople = nextPeople.map((p) => (p.id === person.id ? { ...p, tasks: [...p.tasks, task] } : p))
      changed = true
    }
  }
  return { people: nextPeople, sprints: nextSprints, changed, pushes }
}

/** Reads the tracker through the QA API; any failure just means nothing to sync. */
export async function fetchTracker() {
  const get = async (path) => {
    const res = await fetch(`/api/resources${path}`, { credentials: 'include' })
    if (!res.ok) throw new Error(`Server answered ${res.status}`)
    return res.json()
  }
  const trackerSprints = await get('/sprints')
  const itemsBySprint = {}
  await Promise.all(
    trackerSprints.map(async (sprint) => {
      itemsBySprint[sprint.id] = await get(`/sprints/${sprint.id}/items`)
    })
  )
  return { trackerSprints, itemsBySprint }
}

export async function pushItem(itemId, body) {
  const res = await fetch(`/api/resources/items/${itemId}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!res.ok) throw new Error(`Server answered ${res.status}`)
}

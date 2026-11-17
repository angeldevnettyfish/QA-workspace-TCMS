import {
  loadPeople,
  loadScrumView,
  loadSprints,
  normalizePerson,
  normalizeScrumView,
  normalizeSprint,
  savePeople,
  saveScrumView,
  saveSprints
} from './scrum'

// The board is stored by the QA backend; localStorage stays as an offline mirror.
const URL = '/api/resources/scrum'
const TIMEOUT = 4000

const withTimeout = (promise, ms = TIMEOUT) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return promise(controller.signal).finally(() => clearTimeout(timer))
}

const asBoard = (raw = {}) => ({
  people: (raw.people ?? []).filter(Boolean).map(normalizePerson),
  sprints: (raw.sprints ?? []).filter(Boolean).map(normalizeSprint)
})

async function getFromServer() {
  const res = await withTimeout((signal) => fetch(URL, { signal, credentials: 'include' }))
  if (!res.ok) throw new Error(`Server answered ${res.status}`)
  const body = await res.json()
  return { ...asBoard(body), view: normalizeScrumView(body.settings?.scrum) }
}

async function putToServer(people, sprints, view) {
  const res = await withTimeout((signal) =>
    fetch(URL, {
      method: 'PUT',
      signal,
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ people, sprints, settings: { scrum: normalizeScrumView(view) } })
    })
  )
  if (!res.ok) throw new Error(`Server answered ${res.status}`)
  return res.json()
}

const readLocal = () => ({ people: loadPeople(), sprints: loadSprints(), view: loadScrumView() })

function writeLocal(people, sprints, view) {
  savePeople(people)
  saveSprints(sprints)
  saveScrumView(view)
}

export async function initScrum() {
  const local = readLocal()
  try {
    const remote = await getFromServer()
    if (!remote.people.length && !remote.sprints.length && (local.people.length || local.sprints.length)) {
      await putToServer(local.people, local.sprints, local.view)
      return { ...local, online: true, migrated: local.people.length }
    }
    writeLocal(remote.people, remote.sprints, remote.view)
    return { ...remote, online: true, migrated: 0 }
  } catch (err) {
    return { ...local, online: false, migrated: 0, error: err.message || String(err) }
  }
}

export async function persistScrum(people, sprints, view) {
  writeLocal(people, sprints, view)
  try {
    await putToServer(people, sprints, view)
    return { online: true }
  } catch (err) {
    return { online: false, error: err.message || String(err) }
  }
}

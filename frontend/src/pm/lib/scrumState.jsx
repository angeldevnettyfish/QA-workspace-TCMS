import React from 'react'
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import {
  BACKLOG,
  blankPerson,
  blankTask,
  newId,
    pruneSprintIds,
  todayISO,
  touchTask
} from './scrum'
import { initScrum, persistScrum, refreshScrumBoard } from './scrumStore'

const ScrumContext = createContext(null)
const NO_FEATURES = []

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

function mergeCollection(base = [], local = [], remote = []) {
  const asMap = (items) => new Map((items || []).filter((item) => item?.id).map((item) => [item.id, item]))
  const before = asMap(base)
  const ours = asMap(local)
  const theirs = asMap(remote)
  const ids = new Set([...before.keys(), ...ours.keys(), ...theirs.keys()])
  const merged = []
  ids.forEach((id) => {
    const b = before.get(id)
    const l = ours.get(id)
    const r = theirs.get(id)
    if (!l && !r) return
    if (!l) {
      if (!b || !same(r, b)) merged.push(r)
      return
    }
    if (!r) {
      if (!b || !same(l, b)) merged.push(l)
      return
    }
    merged.push(mergeValue(b, l, r))
  })
  const seen = new Set()
  const orderedIds = [...(local || []), ...(remote || []), ...(base || [])]
    .map((item) => item?.id)
    .filter((id) => {
      if (!id || seen.has(id)) return false
      seen.add(id)
      return true
    })
  const rank = new Map(orderedIds.map((id, index) => [id, index]))
  return merged.sort((a, b) => rank.get(a.id) - rank.get(b.id))
}

function mergeValue(base, local, remote) {
  if (same(local, remote)) return local
  if (same(local, base)) return remote
  if (same(remote, base)) return local
  if (Array.isArray(local) && Array.isArray(remote)) {
    const keyed = [...local, ...remote, ...(base || [])].every((value) => value && typeof value === 'object' && value.id)
    return keyed ? mergeCollection(base, local, remote) : local
  }
  if (local && remote && typeof local === 'object' && typeof remote === 'object' && !Array.isArray(local) && !Array.isArray(remote)) {
    const localVersion = String(local.updatedAt || '')
    const remoteVersion = String(remote.updatedAt || '')
    const preferLocal = !remoteVersion || localVersion >= remoteVersion
    const keys = new Set([...Object.keys(base || {}), ...Object.keys(local), ...Object.keys(remote)])
    const merged = {}
    keys.forEach((key) => {
      const l = local[key]
      const r = remote[key]
      const b = base?.[key]
      if (!(key in local) && !(key in remote)) return
      if (!(key in local)) {
        if (!same(r, b)) merged[key] = r
        return
      }
      if (!(key in remote)) {
        if (!same(l, b)) merged[key] = l
        return
      }
      if (same(l, b)) merged[key] = r
      else if (same(r, b) || same(l, r)) merged[key] = l
      else if (Array.isArray(l) && Array.isArray(r)) {
        const keyed = [...l, ...r, ...(b || [])].every((value) => value && typeof value === 'object' && value.id)
        merged[key] = keyed ? mergeCollection(b, l, r) : (preferLocal ? l : r)
      } else if (l && r && typeof l === 'object' && typeof r === 'object' && !Array.isArray(l) && !Array.isArray(r)) {
        merged[key] = mergeValue(b, l, r)
      } else merged[key] = preferLocal ? l : r
    })
    return merged
  }
  return local
}

function mergeBoard(base, local, remote) {
  return {
    people: mergeCollection(base?.people, local.people, remote.people),
    sprints: mergeCollection(base?.sprints, local.sprints, remote.sprints),
    view: mergeValue(base?.view, local.view, remote.view)
  }
}

const boardData = (board) => ({ people: board.people, sprints: board.sprints, view: board.view })

/**
 * One copy of the scrum board for every view of it. The board and the planning
 * table are both mounted at once, so they have to share this state and the one
 * debounced save — two independent copies would each write the whole board and
 * quietly undo the other's edits.
 */
export function ScrumProvider({ page, session = null, statsSlot, children }) {
  const [people, setPeople] = useState([])
  const [sprints, setSprints] = useState([])
  const [view, setView] = useState({
    hideDone: false,
    statuses: [],
    sprintId: null,
    emailTo: '',
    emailSkip: '',
    planSprintId: null,
    planGroupBy: 'person',
    planHideDone: false,
    fixoraSprintId: '__all'
  })
  const features = NO_FEATURES
  const refreshFeatures = useCallback(async () => [], [])
  // Which day's notes every view is showing; today unless someone looks back.
  const [day, setDay] = useState(todayISO)
  const [store, setStore] = useState({ loading: true, online: false, migrated: 0, error: '' })
  const [retryTick, setRetryTick] = useState(0)
  const serverVersion = useRef(null)
  const serverBoard = useRef(null)
  const currentBoard = useRef({ people, sprints, view })
  const skipNextSave = useRef(false)
  const saveInFlight = useRef(false)
  const setBoardVersion = (value) => {
    const candidate = value ?? null
    const current = serverVersion.current
    if (current !== null && (candidate === null || candidate < current)) return
    serverVersion.current = candidate
  }
  const setServerBoard = (board) => {
    const current = serverVersion.current
    if (current !== null && (!board?.version || board.version < current)) return
    serverBoard.current = board
  }
  currentBoard.current = { people, sprints, view }

  useEffect(() => {
    let cancelled = false
    initScrum().then((loaded) => {
      if (cancelled) return
      const loadedPeople = pruneSprintIds(loaded.people, loaded.sprints)
      serverBoard.current = loaded.online
        ? { people: loadedPeople, sprints: loaded.sprints, view: loaded.view, version: loaded.version ?? null }
        : { people: [], sprints: [], view: loaded.view, version: null }
      setBoardVersion(loaded.version)
      setPeople(loadedPeople)
      setSprints(loaded.sprints)
      // A sprint that was deleted elsewhere must not leave a view filtered to
      // nothing, so an unknown id falls back to every sprint.
      const known = (id) =>
        id === null || id === BACKLOG || loaded.sprints.some((s) => s.id === id)
      setView((v) => ({
        ...v,
        ...loaded.view,
        sprintId: known(loaded.view.sprintId) ? loaded.view.sprintId : null,
        planSprintId: known(loaded.view.planSprintId) ? loaded.view.planSprintId : null
      }))
      setStore({
        loading: false,
        online: loaded.online,
        migrated: loaded.migrated,
        error: loaded.error || ''
      })
    })
    return () => {
      cancelled = true
    }
  }, [])

  /** Re-reads the board from the server, e.g. after someone else logged time. */
  const reload = useCallback(async () => {
    try {
      const remote = await refreshScrumBoard()
      if (serverVersion.current !== null && (!remote.version || remote.version < serverVersion.current)) return true
      const latest = currentBoard.current
      const merged = mergeBoard(serverBoard.current, latest, remote)
      setServerBoard(remote)
      setBoardVersion(remote.version)
      skipNextSave.current = same(merged, boardData(remote))
      setPeople(pruneSprintIds(merged.people, remote.sprints))
      setSprints(merged.sprints)
      setView(merged.view)
      setStore((s) => ({ ...s, online: true, error: '' }))
      return true
    } catch (err) {
      setStore((s) => ({ ...s, online: false, error: err.message || String(err) }))
      return false
    }
  }, [])

  // Save on the same short debounce as the roadmap: names are typed a letter
  // at a time.
  useEffect(() => {
    if (store.loading) return undefined
    if (skipNextSave.current) {
      skipNextSave.current = false
      return undefined
    }
    const timer = setTimeout(async () => {
      if (saveInFlight.current) return
      saveInFlight.current = true
      const sent = { people, sprints, view }
      const result = await persistScrum(people, sprints, view, serverVersion.current)
      if (result.conflict) {
        const remote = result.conflict
        const latest = currentBoard.current
        const merged = mergeBoard(serverBoard.current, latest, remote)
        setServerBoard(remote)
        setBoardVersion(remote.version)
        skipNextSave.current = same(merged, boardData(remote))
        setPeople(pruneSprintIds(merged.people, remote.sprints))
        setSprints(merged.sprints)
        setView(merged.view)
      } else if (result.online) {
        if (serverVersion.current === result.version || !serverVersion.current || result.version >= serverVersion.current) {
          setServerBoard({ ...sent, version: result.version ?? null })
        }
        setBoardVersion(result.version)
      }
      setStore((s) => ({ ...s, online: result.online, error: result.error || '' }))
      saveInFlight.current = false
      if (result.online && !same(boardData(currentBoard.current), sent)) setRetryTick((tick) => tick + 1)
    }, 400)
    return () => clearTimeout(timer)
  }, [people, sprints, view, store.loading, retryTick])

  // Push board changes as soon as the server detects a committed database update.
  useEffect(() => {
    if (store.loading) return undefined
    let active = true
    let syncing = false
    const sync = async () => {
      if (!active || syncing) return
      syncing = true
      try {
        const remote = await refreshScrumBoard()
        if (!active) return
        setStore((s) => ({ ...s, online: true, error: '' }))
        if (remote.version === serverVersion.current || (serverVersion.current !== null && (!remote.version || remote.version < serverVersion.current))) {
          if (serverBoard.current && !same(boardData(currentBoard.current), boardData(serverBoard.current))) {
            setRetryTick((tick) => tick + 1)
          }
          return
        }
        const latest = currentBoard.current
        const merged = mergeBoard(serverBoard.current, latest, remote)
        setServerBoard(remote)
        setBoardVersion(remote.version)
        skipNextSave.current = same(merged, boardData(remote))
        setPeople(pruneSprintIds(merged.people, remote.sprints))
        setSprints(merged.sprints)
        setView(merged.view)
      } catch {
        if (active) setStore((s) => ({ ...s, online: false }))
      } finally {
        syncing = false
      }
    }
    const events = new EventSource('/api/resources/scrum/events', { withCredentials: true })
    events.addEventListener('update', sync)
    events.onopen = () => {
      if (active) void sync()
    }
    const interval = setInterval(sync, 15000)
    return () => {
      active = false
      clearInterval(interval)
      events.close()
    }
  }, [store.loading])

  /**
   * A card for somebody who may sign in. The board and the sign-in list are one
   * list of people joined by their address, so an invitation that already has a
   * card reuses it instead of making a second one under the same name.
   */
  const addPersonCard = ({ name = '', email = '' }) => {
    const address = String(email).trim().toLowerCase()
    const mail = (p) => String(p.email ?? '').trim().toLowerCase()
    const known = address && people.find((p) => mail(p) === address)
    if (known) return known

    // The same rule the server reads addresses by: "Kishore S" was invited,
    // "Kishore" is on the board, and they are one person — so the card gains
    // the address rather than the board gaining a second Kishore.
    const first = (value) => String(value ?? '').trim().toLowerCase().split(/\s+/)[0]
    const free = people.filter((p) => !mail(p))
    const named = name.trim() ? free.filter((p) => first(p.name) === first(name)) : []
    if (named.length === 1) {
      const card = { ...named[0], email: address }
      setPeople((list) => list.map((p) => (p.id === card.id ? card : p)))
      return card
    }

    const person = {
      ...blankPerson(),
      id: newId('pp'),
      name: String(name).trim() || (address ? address.split('@')[0] : ''),
      email: address
    }
    setPeople((list) => [...list, person])
    return person
  }

  /**
   * Tasks from the Add tasks dialog, each carrying its assignee and sprint.
   * Lives here because both the board and the planning table offer that dialog.
   */
  const addTasks = (rows) => {
    const byPerson = new Map()
    rows.forEach((row) => {
      if (!byPerson.has(row.personId)) byPerson.set(row.personId, [])
      byPerson.get(row.personId).push(
        touchTask({
          ...blankTask(),
          id: newId('tk'),
          title: row.title,
          notes: row.notes || '',
          estimate: row.estimate || 0,
          featureId: row.featureId || '',
          sprintId: typeof row.sprintId === 'string' ? row.sprintId : BACKLOG
        })
      )
    })
    setPeople((list) =>
      list.map((person) => {
        const created = byPerson.get(person.id)
        return created ? { ...person, tasks: [...person.tasks, ...created] } : person
      })
    )
  }

  const value = {
    people,
    setPeople,
    sprints,
    setSprints,
    view,
    setView,
    features,
    session,
    refreshFeatures,
    addPersonCard,
    addTasks,
    reload,
    activeTab: page,
    statsSlot,
    day,
    setDay,
    store
  }

  return <ScrumContext.Provider value={value}>{children}</ScrumContext.Provider>
}

export function useScrum() {
  const value = useContext(ScrumContext)
  if (!value) throw new Error('useScrum must be used inside a ScrumProvider')
  return value
}

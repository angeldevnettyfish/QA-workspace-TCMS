import React from 'react'
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import {
  BACKLOG,
  blankPerson,
  blankTask,
  newId,
    pruneSprintIds,
  todayISO,
  touchTask
} from './scrum'
import { initScrum, persistScrum } from './scrumStore'

const ScrumContext = createContext(null)
const NO_FEATURES = []

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

  useEffect(() => {
    let cancelled = false
    initScrum().then((loaded) => {
      if (cancelled) return
      setPeople(pruneSprintIds(loaded.people, loaded.sprints))
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
    const loaded = await initScrum()
    setPeople(pruneSprintIds(loaded.people, loaded.sprints))
    setSprints(loaded.sprints)
    setStore((s) => ({ ...s, online: loaded.online, error: loaded.error || '' }))
    return loaded.online
  }, [])

  // Save on the same short debounce as the roadmap: names are typed a letter
  // at a time.
  useEffect(() => {
    if (store.loading) return undefined
    const timer = setTimeout(async () => {
      const result = await persistScrum(people, sprints, view)
      setStore((s) => ({ ...s, online: result.online, error: result.error || '' }))
    }, 400)
    return () => clearTimeout(timer)
  }, [people, sprints, view, store.loading])

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
  const addTasks = (rows) =>
    setPeople((list) =>
      list.map((person) => {
        const mine = rows.filter((r) => r.personId === person.id)
        if (!mine.length) return person
        const created = mine.map((r) =>
          touchTask({
            ...blankTask(),
            id: newId('tk'),
            title: r.title,
            notes: r.notes || '',
            estimate: r.estimate || 0,
            featureId: r.featureId || '',
            sprintId: typeof r.sprintId === 'string' ? r.sprintId : BACKLOG
          })
        )
        return { ...person, tasks: [...person.tasks, ...created] }
      })
    )

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

import React from 'react'
import { useEffect, useState } from 'react'

export function peopleChoices(people) {
  const counts = new Map()
  people.forEach((person) => {
    const name = person.name.trim() || 'unnamed'
    counts.set(name, (counts.get(name) || 0) + 1)
  })
  const labels = new Map()
  const byLabel = new Map()
  people.forEach((person) => {
    const name = person.name.trim() || 'unnamed'
    const suffix = person.email || `#${person.id.slice(-6)}`
    const label = counts.get(name) > 1 ? `${name} · ${suffix}` : name
    const unique = byLabel.has(label) ? `${label} · #${person.id.slice(-6)}` : label
    labels.set(person.id, unique)
    byLabel.set(unique, person.id)
  })
  return { labels, byLabel, options: [...labels].map(([id, label]) => ({ id, label })) }
}

export function PeopleOptions({ choices, listId }) {
  return (
    <datalist id={listId}>
      {choices.options.map(({ id, label }) => <option key={id} value={label} />)}
    </datalist>
  )
}

export default function PeoplePicker({ personId, choices, listId, onChange, className, title, ariaLabel }) {
  const selected = choices.labels.get(personId) || ''
  const [draft, setDraft] = useState(selected)
  useEffect(() => setDraft(selected), [selected])

  return (
    <input
      type="text"
      list={listId}
      className={className}
      value={draft}
      title={title}
      aria-label={ariaLabel}
      onBlur={() => setDraft(selected)}
      onChange={(event) => {
        setDraft(event.target.value)
        const nextId = choices.byLabel.get(event.target.value)
        if (nextId) {
          onChange(nextId)
          setDraft(choices.labels.get(nextId) || '')
        }
      }}
    />
  )
}

import React from 'react'
const pad = (n) => String(n).padStart(2, '0')
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** offset 0 = the month we are in, -1 = the one before it. */
const monthRange = (offset) => {
  const now = new Date()
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0)
  return { from: iso(first), to: iso(last) }
}

const PRESETS = [
  { id: 'current', label: 'This month', offset: 0 },
  { id: 'last', label: 'Last month', offset: -1 }
]

function ChipGroup({ label, options, selected, onToggle, onAll }) {
  if (options.length <= 1) return null
  return (
    <div className="filter-block">
      <div className="filter-head">
        <span>{label}</span>
        <button type="button" className="link" onClick={onAll}>
          {selected.size === options.length ? 'none' : 'all'}
        </button>
      </div>
      <div className="chips">
        {options.map((o) => (
          <button
            type="button"
            key={o}
            className={`chip${selected.has(o) ? ' on' : ''}`}
            onClick={() => onToggle(o)}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function Filters({ facets, filters, setFilters }) {
  const toggle = (kind, value) =>
    setFilters((f) => {
      const next = new Set(f[kind])
      next.has(value) ? next.delete(value) : next.add(value)
      return { ...f, [kind]: next }
    })

  const toggleAll = (kind, options) =>
    setFilters((f) => ({
      ...f,
      [kind]: f[kind].size === options.length ? new Set() : new Set(options)
    }))

  const applyPreset = (offset) => {
    const range = monthRange(offset)
    setFilters((f) => ({ ...f, ...range }))
  }

  const activePreset = PRESETS.find((p) => {
    const r = monthRange(p.offset)
    return filters.from === r.from && filters.to === r.to
  })

  return (
    <section className="filters">
      <ChipGroup
        label="Members"
        options={facets.members}
        selected={filters.members}
        onToggle={(v) => toggle('members', v)}
        onAll={() => toggleAll('members', facets.members)}
      />
      <div className="filter-block">
        <div className="filter-head">
          <span>Date range</span>
          {(filters.from || filters.to) && (
            <button
              type="button"
              className="link"
              onClick={() => setFilters((f) => ({ ...f, from: '', to: '' }))}
            >
              clear
            </button>
          )}
        </div>
        <div className="row">
          <input
            type="date"
            value={filters.from}
            min={facets.minDate}
            max={facets.maxDate}
            onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
          />
          <span className="dash">→</span>
          <input
            type="date"
            value={filters.to}
            min={facets.minDate}
            max={facets.maxDate}
            onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
          />
        </div>
        <div className="chips presets">
          {PRESETS.map((p) => (
            <button
              type="button"
              key={p.id}
              className={`chip${activePreset?.id === p.id ? ' on' : ''}`}
              onClick={() => applyPreset(p.offset)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div className="filter-block grow">
        <div className="filter-head">
          <span>Search task / note</span>
        </div>
        <input
          type="search"
          placeholder="e.g. drip campaigns"
          value={filters.query}
          onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
        />
      </div>
    </section>
  )
}

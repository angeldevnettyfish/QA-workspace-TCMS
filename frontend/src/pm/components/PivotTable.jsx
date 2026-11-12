import React from 'react'
export default function PivotTable({ pivot, rowLabel, format, sort, onSort, onDrill, onRowClick }) {
  const arrow = (col) => (sort.by === col ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '')

  // Shade each cell by its share of the largest cell so heavy tasks stand out.
  const shade = (v) =>
    v > 0 && pivot.maxCell > 0
      ? { background: `rgba(79, 110, 247, ${0.06 + (v / pivot.maxCell) * 0.34})` }
      : undefined

  if (!pivot.rows.length) {
    return <p className="empty">No rows match the current filters.</p>
  }

  return (
    <div className="table-wrap">
      <table className="pivot">
        <thead>
          <tr>
            <th className="corner sticky-col" onClick={() => onSort('label')}>
              {rowLabel}
              {arrow('label')}
            </th>
            {pivot.columns.map((c) => (
              <th key={c} onClick={() => onSort(c)} title={c}>
                {c}
                {arrow(c)}
                {onDrill && (
                  <button
                    type="button"
                    className="drill"
                    title={`Daily timetable for ${c}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      onDrill(c)
                    }}
                  >
                    ⤢
                  </button>
                )}
              </th>
            ))}
            <th className="total-col" onClick={() => onSort('total')}>
              Total{arrow('total')}
            </th>
          </tr>
        </thead>
        <tbody>
          {pivot.rows.map((r) => (
            <tr key={r.key}>
              <th className="sticky-col row-label" title={r.key}>
                {onRowClick ? (
                  <button type="button" className="link row-open" onClick={() => onRowClick(r.key)}>
                    {r.key}
                  </button>
                ) : (
                  r.key
                )}
              </th>
              {r.values.map((v, i) => (
                <td key={pivot.columns[i]} style={shade(v)}>
                  {v ? format(v) : <span className="zero">·</span>}
                </td>
              ))}
              <td className="total-col">{format(r.total)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th className="sticky-col">Grand Total</th>
            {pivot.columnTotals.map((v, i) => (
              <td key={pivot.columns[i]}>{format(v)}</td>
            ))}
            <td className="total-col">{format(pivot.grandTotal)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

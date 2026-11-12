import React from 'react'
import { useRef, useState } from 'react'

export default function FileDrop({ onFile, busy, fileName }) {
  const inputRef = useRef(null)
  const [over, setOver] = useState(false)

  const handleFiles = (files) => {
    const file = files && files[0]
    if (file) onFile(file)
  }

  return (
    <div
      className={`dropzone${over ? ' over' : ''}${busy ? ' busy' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        handleFiles(e.dataTransfer.files)
      }}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.xlsm,.csv"
        hidden
        onChange={(e) => {
          handleFiles(e.target.files)
          e.target.value = ''
        }}
      />
      <div className="dropzone-icon">⬆</div>
      <div>
        <strong>{busy ? 'Reading workbook…' : 'Drop your timesheet export here'}</strong>
        <p>{fileName ? `Loaded: ${fileName} — click to replace` : 'or click to browse (.xlsx, .xls, .csv)'}</p>
      </div>
    </div>
  )
}

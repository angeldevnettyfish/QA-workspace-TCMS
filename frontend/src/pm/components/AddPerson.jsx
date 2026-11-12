import React from 'react'
import { useEffect, useState } from 'react'

/** Puts a new person's card on the board: a name, and optionally an email. */
export default function AddPerson({ onAdd, onClose }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = (e) => {
    e.preventDefault()
    if (!name.trim() && !email.trim()) return
    onAdd({ name, email })
    onClose()
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal sheet" role="dialog" aria-modal="true" aria-label="Add person" onSubmit={submit}>
        <div className="modal-head">
          <div>
            <h2>Add person</h2>
            <p>Give them a card on the board, then add their tasks.</p>
          </div>
          <div className="modal-actions">
            <button type="button" className="close" onClick={onClose} title="Close">✕</button>
          </div>
        </div>
        <div className="modal-body">
          <div className="add-person-fields">
            <label>
              Name
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Tom Tester" />
            </label>
            <label>
              Email (optional)
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
            </label>
          </div>
        </div>
        <div className="modal-foot">
          <span />
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary">Add person</button>
        </div>
      </form>
    </div>
  )
}

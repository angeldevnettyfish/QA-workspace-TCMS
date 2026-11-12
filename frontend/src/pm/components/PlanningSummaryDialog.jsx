import React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { BACKLOG, sprintLabel, sprintRange, todayISO } from '../lib/scrum'
import { useScrum } from '../lib/scrumState'
import { renderBugChartPng } from '../lib/bugTrend'
import {
  defaultReviewPair,
  isValidEmail,
  parseAddresses,
  planningSummary,
  standupSummary
} from '../lib/planningMail'

const NONE = ''

/**
 * Planning summary email: what was finished in the sprint that just ended and
 * what is planned for the next one, previewed before anything is sent. The
 * preview is exactly what goes out; Send hands it to the QA backend's mail
 * settings, and the copy and mail-app buttons work without them.
 */
export default function PlanningSummaryDialog({ onClose, mode = 'planning' }) {
  const standup = mode === 'standup'
  const { people, sprints, view, setView, day: boardDay } = useScrum()
  const [noteDay, setNoteDay] = useState(boardDay || todayISO())
  // null = every sprint, BACKLOG = tasks with no sprint, otherwise one sprint
  const [scope, setScope] = useState(view.sprintId ?? '__all')
  const pair = useMemo(() => defaultReviewPair(sprints), [sprints])
  const [previousId, setPreviousId] = useState(pair.previous?.id ?? NONE)
  const [nextId, setNextId] = useState(pair.next?.id ?? NONE)
  const [recipients, setRecipients] = useState(() => {
    const saved = parseAddresses(view.emailTo)
    if (saved.length) return saved
    return parseAddresses(people.map((p) => p.email).join(' '))
  })
  const [draft, setDraft] = useState('')
  const [signature, setSignature] = useState(view.emailSignature || '')
  const [subjectEdit, setSubjectEdit] = useState(null)
  const [tab, setTab] = useState('formatted')
  const [status, setStatus] = useState(null)
  const [sending, setSending] = useState(false)
  const [maxed, setMaxed] = useState(false)

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !sending && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, sending])

  const previous = sprints.find((s) => s.id === previousId) || null
  const next = sprints.find((s) => s.id === nextId) || null
  const scopeId = scope === '__all' ? null : scope
  const scopeName =
    scope === '__all' ? '' : scope === BACKLOG ? 'Backlog' : sprintLabel(sprints.find((s) => s.id === scope) || { name: '' }, sprints.findIndex((s) => s.id === scope))
  const summary = useMemo(
    () =>
      standup
        ? standupSummary({ people, sprintId: scopeId, sprintName: scopeName, day: noteDay, signature })
        : planningSummary({ people, previous, next, sprints, signature }),
    [standup, people, scopeId, scopeName, noteDay, previous, next, sprints, signature]
  )
  const subject = subjectEdit ?? summary.subject
  // The chart is drawn once here: the preview shows it inline, and Send attaches the same picture.
  const chartPng = useMemo(() => (summary.trend?.length ? renderBugChartPng(summary.trend) : ''), [summary.trend])
  const previewHtml = chartPng ? summary.html.replace('cid:bugtrend', chartPng) : summary.html

  const addRecipients = (text) => {
    const found = parseAddresses(text)
    if (!found.length) return
    setRecipients((list) => {
      const known = new Set(list.map((a) => a.toLowerCase()))
      return [...list, ...found.filter((a) => !known.has(a.toLowerCase()))]
    })
    setDraft('')
  }

  const rememberChoices = () =>
    setView((v) => ({ ...v, emailTo: recipients.join(', '), emailSignature: signature }))

  const invalid = recipients.filter((a) => !isValidEmail(a))
  const canSend = recipients.length > 0 && invalid.length === 0 && (standup || previous || next) && !sending

  const send = async () => {
    setSending(true)
    setStatus(null)
    rememberChoices()
    try {
      const res = await fetch('/api/resources/email/summary', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          to: recipients,
          subject,
          text: summary.text,
          html: summary.html,
          images: chartPng ? [{ cid: 'bugtrend', data: chartPng.split(',')[1] }] : []
        })
      })
      if (!res.ok) {
        let detail = ''
        try {
          detail = (await res.json()).detail
        } catch {
          /* keep the generic message */
        }
        throw new Error(typeof detail === 'string' && detail ? detail : `The server answered ${res.status}`)
      }
      setStatus({ ok: true, text: `Sent to ${recipients.length} recipient(s).` })
    } catch (err) {
      setStatus({ ok: false, text: err.message || String(err) })
    } finally {
      setSending(false)
    }
  }

  const sprintOptions = sprints.map((s) => ({ id: s.id, label: `${sprintLabel(s, sprints.indexOf(s))} · ${sprintRange(s)}` }))

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !sending && onClose()}>
      <div className={`modal sheet mail-dialog${maxed ? ' maxed' : ''}`} role="dialog" aria-modal="true" aria-label={standup ? 'Testers notes email' : 'Planning summary email'}>
        <div className="modal-head">
          <div>
            <h2>{standup ? 'Send Email — testers’ notes' : 'Planning Summary Email'}</h2>
            <p>
              {standup ? (
                'Every tester’s note for the day, with the open tasks they are on. Check the preview, then send it.'
              ) : (
                <>
                  What was finished {previous ? <>in <strong>{sprintLabel(previous, sprints.indexOf(previous))}</strong></> : 'in the previous sprint'}, and what is
                  planned {next ? <>for <strong>{sprintLabel(next, sprints.indexOf(next))}</strong></> : 'for the next one'}. Check the preview, then send it.
                </>
              )}
            </p>
          </div>
          <div className="modal-actions">
            <button
              type="button"
              className="close"
              onClick={() => setMaxed((v) => !v)}
              aria-pressed={maxed}
              title={maxed ? 'Restore size' : 'Maximize'}
              aria-label={maxed ? 'Restore size' : 'Maximize'}
            >
              {maxed ? '⤡' : '⤢'}
            </button>
            <button type="button" className="close" onClick={onClose} disabled={sending} title="Close">
              ✕
            </button>
          </div>
        </div>

        <div className="modal-body mail-body">
          <div className="mail-field">
            <span className="mail-label">To</span>
            <div className="mail-recipients">
              {recipients.map((a) => (
                <span key={a} className={`mail-chip${isValidEmail(a) ? '' : ' bad'}`}>
                  {a}
                  <button type="button" aria-label={`Remove ${a}`} onClick={() => setRecipients((l) => l.filter((x) => x !== a))}>
                    ✕
                  </button>
                </span>
              ))}
              <input
                value={draft}
                placeholder={recipients.length ? 'add someone else…' : 'type an address and press Enter'}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (['Enter', ',', ';', ' '].includes(e.key) && draft.trim()) {
                    e.preventDefault()
                    addRecipients(draft)
                  } else if (e.key === 'Backspace' && !draft && recipients.length) {
                    setRecipients((l) => l.slice(0, -1))
                  }
                }}
                onBlur={() => draft.trim() && addRecipients(draft)}
              />
            </div>
          </div>

          <div className="mail-row">
            {standup ? (
              <>
                <label>
                  Notes for
                  <input type="date" value={noteDay} onChange={(e) => { setNoteDay(e.target.value); setSubjectEdit(null) }} />
                </label>
                <label>
                  Sprint
                  <select value={scope} onChange={(e) => { setScope(e.target.value); setSubjectEdit(null) }}>
                    <option value="__all">All sprints</option>
                    {sprintOptions.map((o) => (
                      <option key={o.id} value={o.id}>{o.label}</option>
                    ))}
                    <option value={BACKLOG}>Backlog</option>
                  </select>
                </label>
              </>
            ) : (
              <>
                <label>
                  Done in
                  <select value={previousId} onChange={(e) => { setPreviousId(e.target.value); setSubjectEdit(null) }}>
                    <option value={NONE}>— none —</option>
                    {sprintOptions.map((o) => (
                      <option key={o.id} value={o.id}>{o.label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Planned for
                  <select value={nextId} onChange={(e) => { setNextId(e.target.value); setSubjectEdit(null) }}>
                    <option value={NONE}>— none —</option>
                    {sprintOptions.map((o) => (
                      <option key={o.id} value={o.id}>{o.label}</option>
                    ))}
                  </select>
                </label>
              </>
            )}
            <label>
              Signed
              <input value={signature} placeholder="your name" onChange={(e) => setSignature(e.target.value)} />
            </label>
            <label className="mail-subject-inline">
            Subject
            <input value={subject} onChange={(e) => setSubjectEdit(e.target.value)} />
            </label>
          </div>

          <div className="mail-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'formatted'} className={tab === 'formatted' ? 'on' : undefined} onClick={() => setTab('formatted')}>
              Formatted
            </button>
            <button type="button" role="tab" aria-selected={tab === 'plain'} className={tab === 'plain' ? 'on' : undefined} onClick={() => setTab('plain')}>
              Plain text
            </button>
            <span className="muted">
              {standup
                ? `${summary.counts.people} tester(s) · ${summary.counts.notes} note(s)`
                : `${summary.counts.done} done · ${summary.counts.planned} planned${summary.counts.plannedHours ? ` · ${summary.counts.plannedHours} h estimated` : ''}`}
            </span>
          </div>

          {tab === 'formatted' ? (
            <div className="mail-preview" dangerouslySetInnerHTML={{ __html: previewHtml }} />
          ) : (
            <pre className="mail-preview plain">{summary.text}</pre>
          )}
        </div>

        <div className="modal-foot mail-foot">
          <span className={status ? (status.ok ? 'mail-ok' : 'mail-err') : 'muted'} role="status">
            {status ? status.text : invalid.length ? `Fix the address: ${invalid[0]}` : `${summary.text.split('\n').length} line(s) of plain text`}
          </span>
          <button type="button" className="primary" onClick={send} disabled={!canSend}>
            {sending ? 'Sending…' : `Send to ${recipients.length}`}
          </button>
        </div>
      </div>
    </div>
  )
}

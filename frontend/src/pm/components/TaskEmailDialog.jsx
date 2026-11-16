import React, {useEffect, useMemo, useState} from 'react'
import {isValidEmail, parseAddresses} from '../lib/planningMail'
import {activeTimeEntries, entryHours, spentHours, sprintLabel} from '../lib/scrum'

export default function TaskEmailDialog({task, owner, people, sprints, onClose}) {
  const participants=useMemo(()=>{
    const ids=new Set([owner.id,...activeTimeEntries(task).map(entry=>entry.memberId).filter(Boolean)])
    return people.filter(person=>ids.has(person.id))
  },[owner.id,people,task])
  const [to,setTo]=useState(()=>parseAddresses(participants.map(person=>person.email).filter(isValidEmail).join(', ')).join(', '))
  const [cc,setCc]=useState('')
  const [subject,setSubject]=useState(`Task update: ${task.title||'Untitled task'}`)
  const [message,setMessage]=useState('')
  const [sending,setSending]=useState(false)
  const [status,setStatus]=useState(null)

  useEffect(()=>{
    const onKey=event=>event.key==='Escape'&&!sending&&onClose()
    window.addEventListener('keydown',onKey)
    return()=>window.removeEventListener('keydown',onKey)
  },[onClose,sending])
  const recipients=parseAddresses(to)
  const ccRecipients=parseAddresses(cc).filter(address=>!recipients.some(toAddress=>toAddress.toLowerCase()===address.toLowerCase()))
  const invalid=[...recipients,...ccRecipients].filter(address=>!isValidEmail(address))

  const taskContext=()=>{
    const sprint=sprints.find(item=>item.id===task.sprintId)
    const byPerson=new Map()
    activeTimeEntries(task).forEach(entry=>{
      const memberId=entry.memberId||owner.id
      byPerson.set(memberId,(byPerson.get(memberId)||0)+entryHours(entry))
    })
    const timeRows=byPerson.size
      ?[...byPerson].map(([memberId,hours])=>`- ${people.find(person=>person.id===memberId)?.name.trim()||'Unassigned'}: ${Math.round(hours*100)/100} h`).join('\n')
      :`- ${owner.name.trim()||'Unassigned'}: ${spentHours(task)} h`
    return [
      '',
      'Task details',
      '------------',
      `Task: ${task.title||'Untitled task'}`,
      `Sprint: ${sprint?sprintLabel(sprint,sprints.indexOf(sprint)):'Backlog'}`,
      `Owner: ${owner.name||'Unassigned'}`,
      `Status: ${task.status}`,
      `Result: ${task.testResult}`,
      `Estimated hours: ${task.estimate||0}`,
      'Time by person:',
      timeRows,
      task.notes?`Task notes: ${task.notes}`:'',
      task.testDetails?`Test details: ${task.testDetails}`:'',
      task.environment?`Test environment: ${task.environment}`:'',
      task.defects?`Defect IDs: ${task.defects}`:''
    ].filter(Boolean).join('\n')
  }

  const send=async()=>{
    setSending(true);setStatus(null)
    try{
      const response=await fetch('/api/resources/email/task',{
        method:'POST',credentials:'include',headers:{'content-type':'application/json'},
        body:JSON.stringify({to:recipients,cc:ccRecipients,subject,text:`${message.trim()}${taskContext()}`})
      })
      if(!response.ok){
        let detail=''
        try{detail=(await response.json()).detail}catch{/* generic error */}
        throw new Error(typeof detail==='string'&&detail?detail:`The server answered ${response.status}`)
      }
      setStatus({ok:true,text:`Sent to ${recipients.length} To and ${ccRecipients.length} CC recipient(s).`})
    }catch(error){setStatus({ok:false,text:error.message||String(error)})}
    finally{setSending(false)}
  }

  return <div className="modal-backdrop task-email-backdrop" onMouseDown={event=>event.target===event.currentTarget&&!sending&&onClose()}>
    <div className="modal task-email-dialog" role="dialog" aria-modal="true" aria-labelledby="task-email-title">
      <header className="modal-head"><div><h2 id="task-email-title">Email task participants</h2><p>Sent from the configured QA mail account.</p></div><button type="button" className="close" disabled={sending} onClick={onClose} aria-label="Close">✕</button></header>
      <div className="task-email-form">
        <label>To<input value={to} onChange={event=>setTo(event.target.value)} placeholder="Task owner and contributors"/></label>
        <label>CC<input value={cc} onChange={event=>setCc(event.target.value)} placeholder="Add CC addresses, comma separated"/></label>
        <label>Subject<input value={subject} maxLength={200} onChange={event=>setSubject(event.target.value)}/></label>
        <label>Message<textarea value={message} required maxLength={100000} rows={8} placeholder="Write your update to the task team…" onChange={event=>setMessage(event.target.value)}/></label>
        {invalid.length>0&&<p className="error" role="alert">Check these email addresses: {invalid.join(', ')}</p>}
        {status&&<p className={status.ok?'resource-message':'error'} role={status.ok?'status':'alert'}>{status.text}</p>}
      </div>
      <footer className="modal-foot"><button type="button" className="secondary" disabled={sending} onClick={onClose}>Cancel</button><button type="button" disabled={sending||!message.trim()||!recipients.length||invalid.length>0||!subject.trim()} onClick={send}>{sending?'Sending…':'Send email'}</button></footer>
    </div>
  </div>
}

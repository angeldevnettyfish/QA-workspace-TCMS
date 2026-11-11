import {useEffect, useRef, useState, type FormEvent} from 'react';
import {CheckCircle2, Clock, Info, Pencil, Play, Square, Trash2, Users, X} from 'lucide-react';
import {Table} from '../components/ui';

type Item = {id:number;archived:boolean} & Record<string,any>;
type Entry = {id:number;member:string;start_at:string;end_at:string|null;note:string};
type Api = (path:string, options?:RequestInit)=>Promise<any>;
const duration=(seconds:number)=>{
  const minutes=Math.floor(Math.max(0,seconds)/60);
  return `${Math.floor(minutes/60).toString().padStart(2,'0')}:${(minutes%60).toString().padStart(2,'0')}:${Math.floor(Math.max(0,seconds)%60).toString().padStart(2,'0')}`;
};
const dateTime=(value:string)=>new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
const hours=(value:number|null)=>`${Number(value??0).toLocaleString(undefined,{maximumFractionDigits:2})} h`;

export default function ResourceTaskDetails({item,sprint,api,onClose,onEdit,onChanged}:{item:Item;sprint:string;api:Api;onClose:()=>void;onEdit:()=>void;onChanged:()=>Promise<void>}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const [entries,setEntries]=useState<Entry[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [now,setNow]=useState(Date.now());
  const [member,setMember]=useState(item.tester||'');
  const [start,setStart]=useState('');
  const [end,setEnd]=useState('');
  const [note,setNote]=useState('');
  const [removeId,setRemoveId]=useState<number|null>(null);
  const base=`/resources/items/${item.id}`;
  useEffect(()=>{
    dialog.current?.showModal();
    let active=true;
    void api(`${base}/timesheets`).then(rows=>{if(active)setEntries(rows);}).catch(e=>{if(active)setError(String(e));}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[api,base]);
  const running=entries.find(entry=>!entry.end_at);
  useEffect(()=>{
    if(!running)return;
    const timer=window.setInterval(()=>setNow(Date.now()),1000);
    return()=>window.clearInterval(timer);
  },[running]);
  const run=async(action:()=>Promise<void>,success:string)=>{
    setBusy(true);setError('');setMessage('');
    try{await action();setEntries(await api(`${base}/timesheets`));await onChanged();setMessage(success);}
    catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally{setBusy(false);}
  };
  const save=(event:FormEvent)=>{
    event.preventDefault();
    if(new Date(end)<=new Date(start)){setError('End time must be after start time.');return;}
    void run(async()=>{
      await api(`${base}/timesheets`,{method:'POST',body:JSON.stringify({member,start_at:new Date(start).toISOString(),end_at:new Date(end).toISOString(),note})});
      setStart('');setEnd('');setNote('');
    },'Timesheet saved. Actual hours updated.');
  };
  const logged=entries.reduce((sum,entry)=>sum+(new Date(entry.end_at??now).getTime()-new Date(entry.start_at).getTime())/1000,0);
  return <dialog ref={dialog} className="task-details" aria-labelledby="task-details-title" onCancel={event=>{if(busy)event.preventDefault();else onClose();}}>
    <header className="task-details-header"><div><div className="task-details-title"><h2 id="task-details-title">{item.item_id}</h2><span className="resource-status">{item.status}</span>{item.archived&&<span className="resource-status">Archived</span>}</div><p>{item.task}</p><small>Related: {sprint}</small></div><button className="secondary task-close" aria-label="Close task details" disabled={busy} onClick={onClose}><X size={20}/></button></header>
    <div className="task-details-body"><main className="task-details-main">
      {error&&<p className="error" role="alert">{error}</p>}{message&&<p className="resource-message" role="status">{message}</p>}
      <div className="task-details-actions"><button disabled={busy||loading||(!running&&item.archived)} onClick={()=>void run(async()=>{await api(`${base}/timer/${running?'stop':'start'}`,{method:'POST'});setNow(Date.now());},running?'Timer stopped. Actual hours updated.':'Timer started.')}>
        {running?<Square size={16}/>:<Play size={16}/>} {running?'Stop timer':'Start timer'}</button>{running&&<strong className="task-live-time" role="timer">{duration((now-new Date(running.start_at).getTime())/1000)}</strong>}<button className="secondary" disabled={busy||!!running} onClick={onEdit}><Pencil size={15}/>Edit task</button></div>
      <section className="task-timesheets"><h3><Clock size={17}/>Timesheets <span>{entries.length}</span></h3>
        {loading?<p role="status">Loading timesheets…</p>:<><Table headers={['Member','Start time','End time','Time spent','']}>
          {entries.map(entry=><tr key={entry.id}><td><strong>{entry.member}</strong>{entry.note&&<small className="task-entry-note">{entry.note}</small>}</td><td>{dateTime(entry.start_at)}</td><td>{entry.end_at?dateTime(entry.end_at):<span className="task-live-time">Running</span>}</td><td>{duration((new Date(entry.end_at??now).getTime()-new Date(entry.start_at).getTime())/1000)}</td><td>{entry.end_at&&(removeId===entry.id?<div className="resource-actions"><button className="secondary" disabled={busy} onClick={()=>setRemoveId(null)}>Cancel</button><button disabled={busy} onClick={()=>void run(async()=>{await api(`${base}/timesheets/${entry.id}`,{method:'DELETE'});setRemoveId(null);},'Timesheet deleted. Actual hours updated.')}>Delete</button></div>:<button className="secondary" aria-label={`Delete timesheet for ${entry.member} at ${dateTime(entry.start_at)}`} disabled={busy} onClick={()=>setRemoveId(entry.id)}><Trash2 size={14}/></button>)}</td></tr>)}
        </Table>{!entries.length&&<p className="task-empty">No time logged yet. Start a timer or add a timesheet below.</p>}</>}
      </section>
      <section className="task-add-time"><h3>Add timesheet</h3><form onSubmit={save}><fieldset disabled={busy||loading||item.archived}><div className="task-time-fields"><label>Start time<input type="datetime-local" required value={start} onChange={e=>setStart(e.target.value)}/></label><label>End time<input type="datetime-local" required value={end} onChange={e=>setEnd(e.target.value)}/></label></div><label>Member<input required maxLength={120} value={member} onChange={e=>setMember(e.target.value)}/></label><label>Note<textarea rows={3} maxLength={20000} placeholder="What did you work on?" value={note} onChange={e=>setNote(e.target.value)}/></label><div className="resource-actions"><button disabled={busy||loading||item.archived}><CheckCircle2 size={15}/>{busy?'Saving…':'Save timesheet'}</button></div></fieldset></form><p className="resource-hint">Times are shown in your local timezone. Saved entries add to the task’s existing actual hours.</p></section>
      <section className="task-description"><h3>Notes</h3><p>{item.comment||'No notes added to this task.'}</p></section>
    </main><aside className="task-details-sidebar"><section><h3><Info size={17}/>Task info</h3><dl>{[
      ['Status',item.status],['Start date',item.start_date||'—'],['End date',item.end_date||'—'],['Priority',item.priority||'—'],['Activity',item.activity||'—'],['Estimated time',hours(item.estimated_hours)],['Actual time',hours(item.actual_hours)],['Timesheet total',duration(logged)],['Completion',item.completion_percent==null?'—':`${item.completion_percent}%`],['Impediment',item.impediment||'—'],['Release',item.release||'—'],
    ].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section><section><h3><Users size={17}/>Assignee</h3><div className="task-assignee"><span className="resource-avatar">{(item.tester||'?').slice(0,2).toUpperCase()}</span><strong>{item.tester||'Unassigned'}</strong></div></section><section><h3>Testing</h3><dl><div><dt>Test cases</dt><dd>{item.test_cases??'—'}</dd></div><div><dt>Defects</dt><dd>{item.defects??'—'}</dd></div><div><dt>Unplanned effort</dt><dd>{hours(item.unplanned_hours)}</dd></div></dl></section></aside></div>
  </dialog>;
}

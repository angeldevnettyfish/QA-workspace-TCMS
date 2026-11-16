import {useEffect, useRef, useState} from 'react';
import {CheckCircle2, ChevronDown, ChevronUp, Clock, Info, Pencil, Play, Plus, Square, Trash2, Users, X} from 'lucide-react';
import {Table} from '../components/ui';

type Item = {id:number;archived:boolean} & Record<string,any>;
type Entry = {id:number;member:string;start_at:string;end_at:string|null;note:string};
type Api = (path:string, options?:RequestInit)=>Promise<any>;
const duration=(seconds:number)=>{
  const minutes=Math.floor(Math.max(0,seconds)/60);
  return `${Math.floor(minutes/60).toString().padStart(2,'0')}:${(minutes%60).toString().padStart(2,'0')}:${Math.floor(Math.max(0,seconds)%60).toString().padStart(2,'0')}`;
};
const localInput=(value:string)=>{const d=new Date(value);const p=(n:number)=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;};
const dateTime=(value:string)=>new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});

export default function ResourceTaskDetails({item,sprint,api,members=[],onClose,onChanged}:{item:Item;members?:string[];sprint:string;api:Api;onClose:()=>void;onChanged:()=>Promise<void>}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const [entries,setEntries]=useState<Entry[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [now,setNow]=useState(Date.now());
  type Draft={id:number|null;member:string;startDate:string;endDate:string;startTime:string;endTime:string;note:string};
  const [draft,setDraft]=useState<Draft|null>(null);
  const [showSheets,setShowSheets]=useState(false);
  const [editNotes,setEditNotes]=useState(false);
  const [notes,setNotes]=useState(item.comment||'');
  const [removeId,setRemoveId]=useState<number|null>(null);
  const base=`/resources/items/${item.id}`;
  useEffect(()=>{
    dialog.current?.showModal();
    let active=true;
    void api(`${base}/timesheets`).then(rows=>{if(active)setEntries(rows);}).catch(e=>{if(active)setError(String(e));}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[api,base]);
  const dayOf=(value:string)=>localInput(value).slice(0,10);
  const timeOf=(value:string)=>localInput(value).slice(11);
  const startNew=(day?:string)=>{const date=day||dayOf(new Date().toISOString());setError('');setMessage('');setDraft({id:null,member:item.tester||members[0]||'',startDate:date,endDate:date,startTime:'',endTime:'',note:''});};
  const startEdit=(entry:Entry)=>{setError('');setMessage('');setDraft({id:entry.id,member:entry.member,startDate:dayOf(entry.start_at),endDate:dayOf(entry.end_at as string),startTime:timeOf(entry.start_at),endTime:timeOf(entry.end_at as string),note:entry.note||''});};
  const saveDraft=()=>{
    if(!draft)return;
    if(!draft.startDate||!draft.endDate||!draft.startTime||!draft.endTime){setError('Enter a start and end date and time.');return;}
    const from=new Date(`${draft.startDate}T${draft.startTime}`),to=new Date(`${draft.endDate}T${draft.endTime}`);
    if(to<=from){setError('End time must be after start time.');return;}
    void run(async()=>{
      await api(draft.id?`${base}/timesheets/${draft.id}`:`${base}/timesheets`,{method:draft.id?'PUT':'POST',body:JSON.stringify({member:draft.member,start_at:from.toISOString(),end_at:to.toISOString(),note:draft.note})});
      setDraft(null);
    },'Timesheet saved. Actual hours updated.');
  };
  const draftRow=(d:Draft)=><tr key="draft" className="task-draft-row"><td><div className="task-draft-member"><select aria-label="Member" value={d.member} onChange={e=>setDraft({...d,member:e.target.value})}>{Array.from(new Set([...members,item.tester||'',d.member].filter(Boolean))).map(name=><option key={name} value={name}>{name}</option>)}</select><input aria-label="Note" maxLength={20000} placeholder="Note" value={d.note} onChange={e=>setDraft({...d,note:e.target.value})}/></div></td><td><input type="date" aria-label="Start date" value={d.startDate} onChange={e=>setDraft({...d,startDate:e.target.value})}/><input type="time" aria-label="Start time" autoFocus value={d.startTime} onChange={e=>setDraft({...d,startTime:e.target.value})}/></td><td><input type="date" aria-label="End date" value={d.endDate} onChange={e=>setDraft({...d,endDate:e.target.value})}/><input type="time" aria-label="End time" value={d.endTime} onChange={e=>setDraft({...d,endTime:e.target.value})}/></td><td>—</td><td><button className="secondary" aria-label="Save timesheet" disabled={busy} onClick={saveDraft}><CheckCircle2 size={14}/></button><button className="secondary" aria-label="Cancel" disabled={busy} onClick={()=>setDraft(null)}><X size={14}/></button></td></tr>;
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

  const TEXT_KEYS=['item_id','task','activity','tester','priority','status','impediment','release','comment'];
  const NUM_KEYS=['estimated_hours','actual_hours','completion_percent','unplanned_hours','test_cases','defects'];
  const itemBody=(changes:Record<string,unknown>)=>{
    const body:Record<string,unknown>={};
    for(const k of TEXT_KEYS)body[k]=item[k]??'';
    for(const k of NUM_KEYS)body[k]=item[k]??null;
    for(const k of ['start_date','end_date'])body[k]=item[k]||null;
    return {...body,...changes};
  };
  const saveField=(key:string,raw:string,type:string)=>{
    const value=type==='number'?(raw.trim()===''?null:Number(raw)):(raw.trim()===''?null:raw.trim());
    if(value===(item[key]??null)||(type==='number'&&Number.isNaN(value)))return;
    if(key==='status'&&!value)return;
    const body=itemBody({[key]:TEXT_KEYS.includes(key)?(value??''):value});
    void run(async()=>{await api(`/resources/items/${item.id}`,{method:'PUT',body:JSON.stringify(body)});},'');
  };
  const OPTIONS:Record<string,string[]>={status:['Not Started','In Progress','Blocked','Completed','Closed'],priority:['Low','Medium','High']};
  const selectField=(key:string,label:string)=><div key={key}><dt><label htmlFor={`task-field-${key}`}>{label}</label></dt><dd><select id={`task-field-${key}`} disabled={busy} value={item[key]||''} onChange={e=>saveField(key,e.target.value,'text')}>{Array.from(new Set([...(OPTIONS[key]||[]),item[key]||''].filter(Boolean))).map(v=><option key={v}>{v}</option>)}{!item[key]&&<option value="">—</option>}</select></dd></div>;
  const field=(key:string,label:string,type:string,list?:string)=><div key={key}><dt><label htmlFor={`task-field-${key}`}>{label}</label></dt><dd><input id={`task-field-${key}`} key={`${key}-${item[key]??''}`} type={type} list={list} step={type==='number'?'any':undefined} disabled={busy} defaultValue={item[key]??''} onBlur={e=>saveField(key,e.target.value,type)} onKeyDown={e=>{if(e.key==='Enter')(e.target as HTMLInputElement).blur();}}/></dd></div>;
  const logged=entries.reduce((sum,entry)=>sum+(new Date(entry.end_at??now).getTime()-new Date(entry.start_at).getTime())/1000,0);
  return <dialog ref={dialog} className="task-details" aria-labelledby="task-details-title" onCancel={event=>{if(busy)event.preventDefault();else onClose();}}>
    <header className="task-details-header"><div><div className="task-details-title"><h2 id="task-details-title">{item.item_id}</h2><span className="resource-status">{item.status}</span>{item.archived&&<span className="resource-status">Archived</span>}</div><p>{item.task}</p><small>Related: {sprint}</small></div><button className="secondary task-close" aria-label="Close task details" disabled={busy} onClick={onClose}><X size={20}/></button></header>
    <div className="task-details-body"><main className="task-details-main">
      {error&&<p className="error" role="alert">{error}</p>}{message&&<p className="resource-message" role="status">{message}</p>}
      <div className="task-details-actions"><button disabled={busy||loading||(!running&&item.archived)} onClick={()=>void run(async()=>{await api(`${base}/timer/${running?'stop':'start'}`,{method:'POST'});setNow(Date.now());},running?'Timer stopped. Actual hours updated.':'Timer started.')}>
        {running?<Square size={16}/>:<Play size={16}/>} {running?'Stop timer':'Start timer'}</button>{running&&<strong className="task-live-time" role="timer">{duration((now-new Date(running.start_at).getTime())/1000)}</strong>}<button type="button" className="secondary" aria-expanded={showSheets} onClick={()=>setShowSheets(open=>!open)}><Clock size={15}/>Timesheet {showSheets?<ChevronUp size={15}/>:<ChevronDown size={15}/>}</button></div>
      <section className="task-timesheets">
        {showSheets&&(loading?<p role="status">Loading timesheets…</p>:<><Table headers={['Member','Start time','End time','Time spent','']}>
          {draft&&draft.id===null&&draftRow(draft)}{entries.map(entry=>draft?.id===entry.id?draftRow(draft):<tr key={entry.id}><td><strong>{entry.member}</strong>{entry.note&&<small className="task-entry-note">{entry.note}</small>}</td><td>{dateTime(entry.start_at)}</td><td>{entry.end_at?dateTime(entry.end_at):<span className="task-live-time">Running</span>}</td><td>{duration((new Date(entry.end_at??now).getTime()-new Date(entry.start_at).getTime())/1000)}</td><td>{entry.end_at&&removeId!==entry.id&&<button className="secondary" aria-label={`Edit timesheet for ${entry.member} at ${dateTime(entry.start_at)}`} disabled={busy||item.archived} onClick={()=>startEdit(entry)}><Pencil size={14}/></button>}{entry.end_at&&(removeId===entry.id?<div className="resource-actions"><button className="secondary" disabled={busy} onClick={()=>setRemoveId(null)}>Cancel</button><button disabled={busy} onClick={()=>void run(async()=>{await api(`${base}/timesheets/${entry.id}`,{method:'DELETE'});setRemoveId(null);},'Timesheet deleted. Actual hours updated.')}>Delete</button></div>:<button className="secondary" aria-label={`Delete timesheet for ${entry.member} at ${dateTime(entry.start_at)}`} disabled={busy} onClick={()=>setRemoveId(entry.id)}><Trash2 size={14}/></button>)}{!item.archived&&<button className="secondary" aria-label="Add timesheet row" title="Add timesheet" disabled={busy||!!draft} onClick={()=>startNew(dayOf(entry.start_at))}><Plus size={14}/></button>}</td></tr>)}
        </Table>{!entries.length&&!draft&&<p className="task-empty">No time logged yet. Start a timer or add a row with +.</p>}{!entries.length&&!item.archived&&<button className="secondary" aria-label="Add timesheet row" title="Add timesheet" disabled={busy||!!draft} onClick={()=>startNew()}><Plus size={14}/></button>}</>)}
      </section>
      <section className="task-description"><h3>Notes</h3>{editNotes?<form onSubmit={event=>{event.preventDefault();const body=itemBody({comment:notes.trim()});void run(async()=>{await api(`/resources/items/${item.id}`,{method:'PUT',body:JSON.stringify(body)});setEditNotes(false);},'Notes saved.');}}><textarea autoFocus rows={5} ref={el=>{if(el){el.style.height='auto';el.style.height=`${el.scrollHeight}px`;}}} onInput={e=>{e.currentTarget.style.height='auto';e.currentTarget.style.height=`${e.currentTarget.scrollHeight}px`;}} maxLength={20000} aria-label="Task notes" placeholder="Add notes for this task" value={notes} disabled={busy} onChange={e=>setNotes(e.target.value)}/><div className="resource-actions"><button type="button" className="secondary" disabled={busy} onClick={()=>{setNotes(item.comment||'');setEditNotes(false);}}>Cancel</button><button disabled={busy}>Save notes</button></div></form>:<p className="task-notes-text" title={item.archived?undefined:'Double-click to edit notes'} onDoubleClick={()=>{if(!item.archived){setNotes(item.comment||'');setEditNotes(true);}}}>{item.comment||'No notes yet. Double-click here to add notes.'}</p>}</section>
    </main><aside className="task-details-sidebar"><section><h3><Info size={17}/>Task info</h3><dl>{[
      ['status','Status','text','select'],['start_date','Start date','date'],['end_date','End date','date'],['priority','Priority','text','select'],['activity','Activity','text','resource-activities'],['estimated_hours','Estimated time (h)','number'],['actual_hours','Actual time (h)','number'],['completion_percent','Completion %','number'],['impediment','Impediment','text','resource-flags'],['release','Release','text'],
    ].map(([key,label,type,list])=>list==='select'?selectField(key,label):field(key,label,type,list))}<div><dt>Timesheet total</dt><dd>{duration(logged)}</dd></div></dl></section><section><h3><Users size={17}/>Assignee</h3><div className="task-assignee"><span className="resource-avatar">{(item.tester||'?').slice(0,2).toUpperCase()}</span><select aria-label="Assignee" disabled={busy} value={item.tester||''} onChange={e=>{const tester=e.target.value;const body=itemBody({tester});void run(async()=>{await api(`/resources/items/${item.id}`,{method:'PUT',body:JSON.stringify(body)});},'');}}>{!item.tester&&<option value="">Unassigned</option>}{Array.from(new Set([...members,item.tester||''].filter(Boolean))).map(name=><option key={name} value={name}>{name}</option>)}</select></div></section><section><h3>Testing</h3><dl>{[['test_cases','Test cases','number'],['defects','Defects','number'],['unplanned_hours','Unplanned effort (h)','number']].map(([key,label,type])=>field(key,label,type))}</dl></section></aside></div>
  </dialog>;
}

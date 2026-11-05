import {useEffect, useRef, useState} from 'react';
import {Field, SelectField, Table} from '../components/ui';

type Row = Record<string, any>;
type Api = (path:string, options?:RequestInit)=>Promise<any>;
function localInput(value:string, timezone:string) {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value));
  const part=(name:string)=>parts.find(p=>p.type===name)?.value;
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}
function scheduledTime(value:string, timezone:string) {
  return new Intl.DateTimeFormat(undefined,{timeZone:timezone,dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
}
export default function AutomationSchedules({open,onClose,projectId,cycleId,cycles,api}: {
  open:boolean;onClose:()=>void;projectId:number;cycleId:number;cycles:Row[];api:Api;
}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const [schedules,setSchedules]=useState<Row[]>([]);
  const [loading,setLoading]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [editing,setEditing]=useState(0);
  const blank=()=>({name:'',cycle_id:cycleId||cycles[0]?.id||0,frequency:'once',timezone:'Asia/Kolkata',start_local:'',enabled:true});
  const [form,setForm]=useState(blank);
  const load=()=>api(`/automation/schedules?project_id=${projectId}`);
  useEffect(()=>{
    if(open&&!editing&&(cycleId||cycles.length))setForm(current=>current.cycle_id?current:{...current,cycle_id:cycleId||cycles[0].id});
  },[open,editing,cycleId,cycles]);
  useEffect(()=>{
    if(open&&!dialog.current?.open)dialog.current?.showModal();
    if(!open&&dialog.current?.open)dialog.current.close();
    if(!open)return;
    let active=true;
    setLoading(true);setError('');setMessage('');setEditing(0);setForm(blank());
    const refresh=()=>void api(`/automation/schedules?project_id=${projectId}`).then(rows=>{if(active)setSchedules(rows);}).catch(reason=>{if(active)setError(String(reason));}).finally(()=>{if(active)setLoading(false);});
    refresh();
    const interval=window.setInterval(refresh,15000);
    return ()=>{active=false;window.clearInterval(interval);};
  },[open,projectId,api]);
  const action=async(task:()=>Promise<void>)=>{
    setBusy(true);setError('');setMessage('');
    try{await task();setSchedules(await load());}catch(reason){setError(reason instanceof Error?reason.message:String(reason));}finally{setBusy(false);}
  };
  const edit=(row:Row)=>{
    setEditing(row.id);setMessage('');setError('');
    setForm({name:row.name,cycle_id:row.cycle_id,frequency:row.frequency,timezone:row.timezone,start_local:localInput(row.start_at,row.timezone),enabled:row.enabled});
  };
  return <dialog ref={dialog} className="automation-history-dialog automation-schedule-dialog" aria-labelledby="automation-schedules-title" onCancel={onClose}>
    <div className="automation-history-header"><h2 id="automation-schedules-title">Automation schedules</h2><button className="secondary" onClick={onClose}>Close schedules</button></div>
    <p>Schedule runs for this project. Keep the TCMS PC and Bitbucket runner available at the scheduled time.</p>
    {error&&<p role="alert" className="warning">{error}</p>}{message&&<p role="status">{message}</p>}
    {loading?<p role="status">Loading schedules…</p>:schedules.length===0?<p>No schedules yet.</p>:<Table headers={['Schedule / cycle','Repeat','Timezone','Next run','Status','Last run','Actions']}>
      {schedules.map(row=><tr key={row.id}>
        <td><b>{row.name}</b><br/>{cycles.find(c=>c.id===row.cycle_id)?.name??row.cycle_id}{row.last_error&&<p className="warning">{row.last_error}</p>}</td>
        <td>{row.frequency}</td><td>{row.timezone==='Asia/Kolkata'?'IST':row.timezone}</td><td>{row.enabled?scheduledTime(row.next_run_at,row.timezone):'—'}</td>
        <td><span className={`automation-run-status ${row.enabled?'passed':row.last_error?'failed':'neutral'}`}>{row.enabled?'Enabled':row.last_error?'Needs attention':row.frequency==='once'&&row.last_run_id?'Completed':'Disabled'}</span></td>
        <td>{row.last_run_id?`#${row.last_run_id}`:'—'}</td>
        <td><div className="automation-schedule-actions"><button className="secondary" disabled={busy} onClick={()=>edit(row)}>Edit</button><button className="secondary" disabled={busy} onClick={()=>void action(async()=>{await api(`/automation/schedules/${row.id}`,{method:'PATCH',body:JSON.stringify({enabled:!row.enabled})});setMessage(row.enabled?'Schedule disabled.':'Schedule enabled.');})}>{row.enabled?'Disable':'Enable'}</button></div></td>
      </tr>)}
    </Table>}
    <form className="automation-schedule-form" onSubmit={event=>{event.preventDefault();void action(async()=>{
      await api(editing?`/automation/schedules/${editing}`:`/automation/schedules?project_id=${projectId}`,{method:editing?'PUT':'POST',body:JSON.stringify(form)});
      setMessage(editing?'Schedule updated.':'Schedule created.');setEditing(0);setForm(blank());
    });}}>
      <h3>{editing?'Edit schedule':'Create schedule'}</h3>
      <div className="grid">
        <Field name="scheduleName" label="Schedule name" value={form.name} required onChange={name=>setForm(f=>({...f,name}))}/>
        <SelectField label="Schedule cycle" value={form.cycle_id} onChange={value=>setForm(f=>({...f,cycle_id:Number(value)}))} items={cycles.map(c=>({value:c.id,label:c.name}))}/>
        <SelectField label="Frequency" value={form.frequency} onChange={frequency=>setForm(f=>({...f,frequency}))} items={[{value:'once',label:'Once'},{value:'daily',label:'Daily'},{value:'weekly',label:'Weekly'}]}/>
        <Field name="scheduleStart" label="Start date and time" type="datetime-local" value={form.start_local} required onChange={start_local=>setForm(f=>({...f,start_local}))}/>
        <SelectField label="Timezone" value={form.timezone} onChange={timezone=>setForm(f=>({...f,timezone}))} items={[{value:'Asia/Kolkata',label:'IST (Asia/Kolkata)'},{value:'UTC',label:'UTC'}]}/>
      </div>
      <p>Daily runs repeat at the selected time. Weekly runs repeat on the selected weekday. Reports appear in this project’s History.</p>
      <label><input type="checkbox" checked={form.enabled} onChange={event=>setForm(f=>({...f,enabled:event.target.checked}))}/> Schedule enabled</label>
      <div className="buttons"><button type="submit" disabled={busy||!form.cycle_id||!form.name.trim()||!form.start_local}>{busy?'Saving…':editing?'Save schedule':'Create schedule'}</button>{editing>0&&<button type="button" className="secondary" onClick={()=>{setEditing(0);setForm(blank());}}>Cancel edit</button>}</div>
    </form>
  </dialog>;
}

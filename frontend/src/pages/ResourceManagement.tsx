import {useCallback, useEffect, useMemo, useRef, useState, type FormEvent} from 'react';
import {Plus, Upload, Download, Pencil, Archive, RotateCcw, Users, Clock, CheckCircle2, AlertCircle} from 'lucide-react';
import {Panel, Table} from '../components/ui';

type Api = (path:string, options?:RequestInit)=>Promise<any>;
type Sprint = {id:number;name:string};
type Item = {id:number;sprint_id:number;archived:boolean} & Record<string,any>;
type Draft = Record<string,string>;
const numberFields=['estimated_hours','actual_hours','completion_percent','unplanned_hours','test_cases','defects'];
const fields=['item_id','start_date','task','activity','tester','priority','estimated_hours','actual_hours','completion_percent','end_date','status','impediment','release','unplanned_hours','test_cases','defects','comment'];
const emptyDraft=():Draft=>Object.fromEntries(fields.map(key=>[key,key==='priority'?'Medium':key==='status'?'Not Started':'']));
const fmt=(value:number|null|undefined)=>value==null?'—':Number(value).toLocaleString(undefined,{maximumFractionDigits:2});
const tone=(status:string)=>['Completed','Closed'].includes(status)?'done':status==='Blocked'?'blocked':status==='In Progress'?'active':'pending';
const displayDate=(value:string)=>value?new Date(value+'T00:00:00').toLocaleDateString(undefined,{day:'2-digit',month:'short',year:'numeric'}):'—';

function RoundMetric({value,label,tone='tasks'}:{value:number;label:string;tone?:string}) {
  return <div className={`resource-round-metric ${tone}`}><div><strong title={fmt(value)}>{fmt(value)}</strong><span>{label}</span></div></div>;
}

export default function ResourceManagement({api}:{api:Api}) {
  const [sprints,setSprints]=useState<Sprint[]>([]);
  const [sprintId,setSprintId]=useState(0);
  const [items,setItems]=useState<Item[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [search,setSearch]=useState('');
  const [tester,setTester]=useState('');
  const [status,setStatus]=useState('');
  const [activity,setActivity]=useState('');
  const [priority,setPriority]=useState('');
  const [showArchived,setShowArchived]=useState(false);
  const [newSprint,setNewSprint]=useState(false);
  const [sprintName,setSprintName]=useState('');
  const [editor,setEditor]=useState<{id:number|null;draft:Draft}|null>(null);
  const dialog=useRef<HTMLDialogElement>(null);
  const fileInput=useRef<HTMLInputElement>(null);
  const [importIntoCurrent,setImportIntoCurrent]=useState(false);
  const selected=sprints.find(s=>s.id===sprintId);
  const loadSprints=useCallback(async()=>{const rows=await api('/resources/sprints') as Sprint[];setSprints(rows);return rows;},[api]);
  const loadItems=useCallback(async(id:number)=>{setItems(await api(`/resources/sprints/${id}/items?include_archived=true`));},[api]);
  useEffect(()=>{let active=true;void api('/resources/sprints').then((rows:Sprint[])=>{if(active){setSprints(rows);setSprintId(rows[0]?.id??0);}}).catch(e=>{if(active)setError(String(e));}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[api]);
  useEffect(()=>{
    setTester('');setStatus('');setActivity('');setPriority('');setSearch('');setItems([]);
    if(!sprintId)return;
    let active=true;setLoading(true);
    void api(`/resources/sprints/${sprintId}/items?include_archived=true`).then(rows=>{if(active)setItems(rows);}).catch(e=>{if(active)setError(String(e));}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[api,sprintId]);
  useEffect(()=>{
    if(editor&&!dialog.current?.open)dialog.current?.showModal();
    if(!editor&&dialog.current?.open)dialog.current.close();
  },[editor]);
  const activeItems=useMemo(()=>items.filter(item=>!item.archived),[items]);
  const totals=useMemo(()=>activeItems.reduce((acc,item)=>({
    estimated:acc.estimated+(item.estimated_hours??0),actual:acc.actual+(item.actual_hours??0),
    unplanned:acc.unplanned+(item.unplanned_hours??0),completed:acc.completed+(['Completed','Closed'].includes(item.status)?1:0),
    blocked:acc.blocked+(item.status==='Blocked'||item.impediment?.toLowerCase()==='yes'?1:0),
    tests:acc.tests+(item.test_cases??0),defects:acc.defects+(item.defects??0),
  }),{estimated:0,actual:0,unplanned:0,completed:0,blocked:0,tests:0,defects:0}),[activeItems]);
  const people=useMemo(()=>{
    const map=new Map<string,{name:string;tasks:number;estimated:number;actual:number;unplanned:number;done:number}>();
    activeItems.forEach(item=>{
      const name=item.tester||'Unassigned';const person=map.get(name)??{name,tasks:0,estimated:0,actual:0,unplanned:0,done:0};
      person.tasks++;person.estimated+=item.estimated_hours??0;person.actual+=item.actual_hours??0;person.unplanned+=item.unplanned_hours??0;
      if(['Completed','Closed'].includes(item.status))person.done++;
      map.set(name,person);
    });return Array.from(map.values()).sort((a,b)=>b.actual-a.actual);
  },[activeItems]);
  const visible=useMemo(()=>items.filter(item=>(showArchived||!item.archived)&&(!tester||(item.tester||'Unassigned')===tester)&&(!status||item.status===status)&&(!activity||item.activity===activity)&&(!priority||item.priority===priority)&&(!search||[item.item_id,item.task,item.tester,item.comment].join(' ').toLowerCase().includes(search.toLowerCase()))),[items,showArchived,tester,status,activity,priority,search]);
  const options=(key:string,defaults:string[]=[])=>Array.from(new Set([...defaults,...items.map(item=>String(item[key]??'')).filter(Boolean)])).sort();
  const work=async(action:()=>Promise<void>)=>{setBusy(true);setError('');setMessage('');try{await action();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
  const startAdd=()=>{
    const draft=emptyDraft();const numbers=items.map(item=>/^ITEM-(\d+)$/.exec(item.item_id)).filter(Boolean).map(match=>Number(match![1]));
    draft.item_id=`ITEM-${String(Math.max(0,...numbers)+1).padStart(2,'0')}`;
    setEditor({id:null,draft});setError('');
  };
  const saveItem=(event:FormEvent)=>{event.preventDefault();if(!editor)return;
    void work(async()=>{
      const body:Record<string,unknown>={...editor.draft};
      numberFields.forEach(key=>{body[key]=editor.draft[key]===''?null:Number(editor.draft[key]);});
      body.start_date=editor.draft.start_date||null;body.end_date=editor.draft.end_date||null;
      await api(editor.id?`/resources/items/${editor.id}`:`/resources/sprints/${sprintId}/items`,{method:editor.id?'PUT':'POST',body:JSON.stringify(body)});
      await loadItems(sprintId);setEditor(null);setMessage('Task saved.');
    });
  };
  const importFile=(file:File)=>void work(async()=>{
    const form=new FormData();form.append('file',file);
    const result=await api(`/resources/import${importIntoCurrent&&sprintId?`?sprint_id=${sprintId}`:''}`,{method:'POST',body:form});
    await loadSprints();setSprintId(result.sprint_id);await loadItems(result.sprint_id);
    setMessage(`${result.imported} tasks imported into ${result.sprint_name}.`);
  });
  const exportFile=()=>void work(async()=>{
    const blob=await api(`/resources/sprints/${sprintId}/export.csv`);
    const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`${selected?.name??'sprint'}-tracker.csv`;link.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  const input=(key:string,label:string,type='text',list?:string)=><label key={key}>{label}<input type={type} list={list} value={editor?.draft[key]??''} required={['item_id','task','status'].includes(key)} min={type==='number'?0:undefined} step={['test_cases','defects'].includes(key)?1:type==='number'?'any':undefined} maxLength={type==='text'?key==='task'?10000:200:undefined} onChange={e=>setEditor(prev=>prev?{...prev,draft:{...prev.draft,[key]:e.target.value}}:null)}/></label>;
  return <div className="resource-page">
    <div className="resource-toolbar"><div><h2>Sprint testing tracker</h2><p>Plan testing work, track effort and review your team’s workload.</p></div><div className="resource-actions"><button className="secondary" disabled={busy} onClick={()=>setNewSprint(v=>!v)}><Plus size={15}/>New sprint</button><button disabled={!sprintId||busy||loading} onClick={startAdd}><Plus size={15}/>Add task</button></div></div>
    {error&&!editor&&<p className="error" role="alert">{error}</p>}{message&&<p className="resource-message" role="status">{message}</p>}
    {newSprint&&<Panel title="New sprint"><form className="resource-new-sprint" onSubmit={e=>{e.preventDefault();void work(async()=>{const sprint=await api('/resources/sprints',{method:'POST',body:JSON.stringify({name:sprintName})});await loadSprints();setSprintId(sprint.id);setSprintName('');setNewSprint(false);setMessage('Sprint created.');});}}><label>Sprint name<input required maxLength={120} value={sprintName} onChange={e=>setSprintName(e.target.value)} placeholder="Sprint_11A"/></label><button disabled={busy}>Create sprint</button><button type="button" className="secondary" disabled={busy} onClick={()=>setNewSprint(false)}>Cancel</button></form></Panel>}
    <div className="resource-sprint-bar"><label>Sprint<select aria-label="Sprint" value={sprintId} disabled={loading||busy} onChange={e=>{setSprintId(Number(e.target.value));setMessage('');setError('');}}><option value={0} disabled>Select a sprint</option>{sprints.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><div className="resource-import"><label className="resource-checkbox"><input type="checkbox" checked={importIntoCurrent} disabled={!sprintId||busy} onChange={e=>setImportIntoCurrent(e.target.checked)}/>Import into selected sprint</label><div className="resource-actions"><button className="secondary" disabled={busy||loading} onClick={()=>fileInput.current?.click()}><Upload size={15}/>Import CSV</button><button className="secondary" disabled={!sprintId||busy||loading} onClick={exportFile}><Download size={15}/>Export CSV</button></div></div><input hidden ref={fileInput} type="file" accept=".csv,text/csv" onChange={e=>{const file=e.target.files?.[0];if(file)importFile(file);e.target.value='';}}/></div>
    <p className="resource-hint">CSV imports append tasks and preserve repeated Item IDs. The same file can only be imported once per sprint. By default, the CSV title selects or creates the sprint.</p>
    {loading?<p role="status">Loading sprint tracker…</p>:!sprintId?<Panel title="Start tracking your team"><p>Create a sprint or import your Sprint Testing Tracker CSV to get started.</p></Panel>:<>
      <div className="resource-stats">
        <div className="resource-summary-stat"><Users size={18}/><span>Tasks / testers</span><div className="resource-round-metrics"><RoundMetric value={activeItems.length} label="Tasks"/><RoundMetric value={people.filter(p=>p.name!=='Unassigned').length} label="Testers" tone="testers"/></div><small>{totals.completed} completed or closed</small></div>
        <div className="resource-summary-stat"><Clock size={18}/><span>Estimated / actual hours</span><div className="resource-round-metrics"><RoundMetric value={totals.estimated} label="Estimated"/><RoundMetric value={totals.actual} label="Actual" tone="testers"/></div><small>Hours · {fmt(totals.actual-totals.estimated)}h variance</small></div>
        <div className="resource-summary-stat"><AlertCircle size={18}/><span>Unplanned effort</span><div className="resource-round-metrics"><RoundMetric value={totals.unplanned} label="Hours" tone="effort"/><RoundMetric value={totals.blocked} label="Blocked" tone="defects"/></div><small>Unplanned hours / blocked or impeded tasks</small></div>
        <div className="resource-summary-stat"><CheckCircle2 size={18}/><span>Test cases / defects</span><div className="resource-round-metrics"><RoundMetric value={totals.tests} label="Test cases"/><RoundMetric value={totals.defects} label="Defects" tone="defects"/></div><small>Recorded for this sprint</small></div>
      </div>
      <Panel title="Team workload" className="resource-workload"><p className="resource-hint">Sprint totals by tester. The bar compares actual hours with estimated hours.</p><div className="resource-people">{people.map(person=><button key={person.name} className={`resource-person ${tester===person.name?'selected':''}`} onClick={()=>setTester(v=>v===person.name?'':person.name)} aria-pressed={tester===person.name}><div className="resource-person-heading"><span className="resource-avatar">{person.name.slice(0,2).toUpperCase()}</span><strong>{person.name}</strong><small>{person.done}/{person.tasks} done</small></div><div className="resource-hours"><span>{fmt(person.actual)}h actual</span><small>{fmt(person.estimated)}h estimated</small></div><div className={`resource-effort ${person.actual>person.estimated?'over':''}`}><span style={{width:`${Math.min(100,person.estimated?person.actual/person.estimated*100:person.actual?100:0)}%`}}/></div><small>{fmt(person.unplanned)}h unplanned{person.actual>person.estimated?` · ${fmt(person.actual-person.estimated)}h over estimate`:''}</small></button>)}</div>{!people.length&&<p>No assignments yet. Add a task to start tracking workload.</p>}</Panel>
      <Panel title={`${selected?.name??'Sprint'} · Task tracker`} className="resource-tracker">
        <div className="resource-filters"><label>Search<input placeholder="Item, task, tester or comment" value={search} onChange={e=>setSearch(e.target.value)}/></label><label>Tester<select value={tester} onChange={e=>setTester(e.target.value)}><option value="">All testers</option>{Array.from(new Set(items.map(i=>i.tester||'Unassigned'))).sort().map(t=><option key={t}>{t}</option>)}</select></label>{[['status','Status',status,setStatus],['activity','Activity',activity,setActivity],['priority','Priority',priority,setPriority]].map(([key,label,value,setter])=><label key={String(key)}>{String(label)}<select value={value as string} onChange={e=>(setter as (v:string)=>void)(e.target.value)}><option value="">All {String(label).toLowerCase()}</option>{options(String(key)).map(v=><option key={v}>{v}</option>)}</select></label>)}<button className="secondary" onClick={()=>{setSearch('');setTester('');setStatus('');setActivity('');setPriority('');}}>Clear filters</button></div>
        <div className="resource-table-meta"><span>{visible.length} of {items.filter(i=>showArchived||!i.archived).length} tasks</span><label className="resource-checkbox"><input type="checkbox" checked={showArchived} onChange={e=>setShowArchived(e.target.checked)}/>Show archived</label></div>
        <Table headers={['Item / Task','Tester','Activity','Priority','Start date','End date','Est. hrs','Actual hrs','Completion %','Status','Impediment','Release','Unplanned hrs','Test cases','Defects','Comment','Actions']}>
          {visible.map(item=><tr key={item.id} className={item.archived?'resource-archived':''}><td className="resource-task-cell"><strong>{item.item_id}</strong><span>{item.task}</span>{item.archived&&<small>Archived</small>}</td><td>{item.tester||'Unassigned'}</td><td>{item.activity||'—'}</td><td><span className={`resource-priority ${item.priority.toLowerCase()}`}>{item.priority||'—'}</span></td><td>{displayDate(item.start_date)}</td><td>{displayDate(item.end_date)}</td><td>{fmt(item.estimated_hours)}</td><td>{fmt(item.actual_hours)}</td><td>{item.completion_percent==null?'—':`${fmt(item.completion_percent)}%`}</td><td><span className={`resource-status ${tone(item.status)}`}>{item.status}</span></td><td>{item.impediment||'—'}</td><td>{item.release||'—'}</td><td>{fmt(item.unplanned_hours)}</td><td>{fmt(item.test_cases)}</td><td>{fmt(item.defects)}</td><td className="resource-comment-cell">{item.comment||'—'}</td><td><div className="resource-row-actions"><button className="secondary" disabled={busy} onClick={()=>{setError('');setEditor({id:item.id,draft:Object.fromEntries(fields.map(key=>[key,item[key]==null?'':String(item[key])]))});}}><Pencil size={14}/>Edit</button><button className="secondary" disabled={busy} onClick={()=>void work(async()=>{await api(`/resources/items/${item.id}/archive?archived=${!item.archived}`,{method:'PATCH'});await loadItems(sprintId);setMessage(item.archived?'Task restored.':'Task archived. Use Show archived to restore it.');})}>{item.archived?<RotateCcw size={14}/>:<Archive size={14}/>}{item.archived?'Restore':'Archive'}</button></div></td></tr>)}
        </Table>{visible.length===0&&<p>No tasks match these filters.</p>}
        <p className="resource-hint">Completion % is entered independently, as in your sheet; values above 100% are preserved. Test case and defect counts are tracker entries.</p>
      </Panel>
    </>}
    <dialog ref={dialog} className="resource-editor" aria-labelledby="resource-editor-title" onCancel={event=>{if(busy)event.preventDefault();else setEditor(null);}}>
      <form onSubmit={saveItem}><div className="resource-editor-heading"><h2 id="resource-editor-title">{editor?.id?'Edit task':'Add task'}</h2><button type="button" className="secondary" disabled={busy} onClick={()=>setEditor(null)}>Close</button></div>
        {error&&editor&&<p className="error" role="alert">{error}</p>}
        <fieldset disabled={busy}><div className="resource-form-grid">{input('item_id','Item ID')}{input('tester','Tester','text','resource-testers')}{input('activity','Test activity','text','resource-activities')}{input('priority','Priority','text','resource-priorities')}<label className="resource-form-wide">Sprint item / task<textarea required maxLength={10000} rows={3} value={editor?.draft.task??''} onChange={e=>setEditor(prev=>prev?{...prev,draft:{...prev.draft,task:e.target.value}}:null)}/></label>{input('start_date','Start date','date')}{input('end_date','End date','date')}{input('status','Status','text','resource-statuses')}{input('completion_percent','Completion %','number')}{input('estimated_hours','Estimated hours','number')}{input('actual_hours','Actual hours','number')}{input('unplanned_hours','Unplanned hours','number')}{input('test_cases','Test cases','number')}{input('defects','Defects','number')}{input('impediment','Impediment','text','resource-flags')}{input('release','Release','text','resource-flags')}<label className="resource-form-wide">Comment<textarea maxLength={20000} rows={4} value={editor?.draft.comment??''} onChange={e=>setEditor(prev=>prev?{...prev,draft:{...prev.draft,comment:e.target.value}}:null)}/></label></div></fieldset>
        <div className="resource-editor-footer"><span>Completion % is saved exactly as entered.</span><button type="button" className="secondary" disabled={busy} onClick={()=>setEditor(null)}>Cancel</button><button disabled={busy}>{busy?'Saving…':'Save task'}</button></div>
      </form>
      {[['resource-testers',options('tester')],['resource-activities',options('activity',['RT','ATSD','ATSE','TCE','TCD','PBA','Prod Deploy'])],['resource-priorities',options('priority',['Low','Medium','High','Critical'])],['resource-statuses',options('status',['Not Started','In Progress','Blocked','Completed','Closed'])],['resource-flags',['Yes','No']]].map(([id,values])=><datalist key={id as string} id={id as string}>{(values as string[]).map(value=><option key={value} value={value}/>)}</datalist>)}
    </dialog>
  </div>;
}

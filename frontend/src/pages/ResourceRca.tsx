import {Fragment, useEffect, useMemo, useRef, useState} from 'react';
import {Plus, Trash2} from 'lucide-react';
import {useScrum} from '../pm/lib/scrumState';
import {sprintLabel} from '../pm/lib/scrum';

type Api = (path:string, options?:RequestInit)=>Promise<any>;
type Entry = {id:string;title:string;sprint:string;reason:string;comment?:string;actions?:string};
const REASONS = ['Test case not written','Test case not executed','Requirement unclear or changed','Out of test scope','Regression not covered','Environment or data difference','Automation gap','Time constraint','Late code change or deployment','Not reproducible in QA','Other'];
const PALETTE=['#39c6aa','#6c8cff','#f0b429','#ef6f6c','#b48cf2','#4cc9f0','#f78fb3','#9bd35a','#ff9f5a','#7f8ea3','#d4c26a'];

function LineChart({points}:{points:{label:string;value:number}[]}) {
  const W=640,H=220,L=48,R=48,T=20,B=56;
  const tilt=points.length>5;
  const max=Math.max(1,...points.map(p=>p.value));
  const top=Math.max(2,Math.ceil(max/2)*2);
  const x=(i:number)=>points.length===1?L+(W-L-R)/2:L+i*((W-L-R)/(points.length-1));
  const y=(v:number)=>T+(H-T-B)*(1-v/top);
  const ticks=[0,top/2,top];
  return <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Issues per sprint: ${points.map(p=>`${p.label} ${p.value}`).join(', ')}`} className="rca-svg">
    {ticks.map(t=><g key={t}><line x1={L} x2={W-R} y1={y(t)} y2={y(t)} stroke="currentColor" opacity=".15"/><text x={L-8} y={y(t)+4} textAnchor="end" fontSize="11" fill="currentColor" opacity=".7">{t}</text></g>)}
    <polyline fill="none" stroke="#39c6aa" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" points={points.map((p,i)=>`${x(i)},${y(p.value)}`).join(' ')}/>
    {points.map((p,i)=><g key={p.label+i}><circle cx={x(i)} cy={y(p.value)} r="4.5" fill="#39c6aa"><title>{`${p.label}: ${p.value} issue${p.value===1?'':'s'}`}</title></circle><text x={x(i)} y={y(p.value)-10} textAnchor="middle" fontSize="11" fill="currentColor">{p.value}</text><text x={x(i)} y={H-B+18} textAnchor={tilt?'end':'middle'} fontSize="9" fill="currentColor" opacity=".85" transform={tilt?`rotate(-30 ${x(i)} ${H-B+18})`:undefined}>{p.label.length>22?`${p.label.slice(0,21)}…`:p.label}</text></g>)}
  </svg>;
}

function PieChart({slices}:{slices:{label:string;value:number;color:string}[]}) {
  const total=slices.reduce((a,b)=>a+b.value,0);
  const R=80,C=100;
  let angle=-Math.PI/2;
  const arc=(value:number)=>{const a0=angle,a1=angle+value/total*2*Math.PI;angle=a1;const large=a1-a0>Math.PI?1:0;return `M${C} ${C} L${C+R*Math.cos(a0)} ${C+R*Math.sin(a0)} A${R} ${R} 0 ${large} 1 ${C+R*Math.cos(a1)} ${C+R*Math.sin(a1)} Z`;};
  return <svg viewBox="0 0 200 200" role="img" aria-label={`Issues by reason: ${slices.map(sl=>`${sl.label} ${sl.value}`).join(', ')}`} className="rca-pie">
    {slices.length===1?<circle cx={C} cy={C} r={R} fill={slices[0].color}><title>{`${slices[0].label}: ${slices[0].value}`}</title></circle>:slices.map(sl=><path key={sl.label} d={arc(sl.value)} fill={sl.color} stroke="var(--surface)" strokeWidth="2"><title>{`${sl.label}: ${sl.value} (${Math.round(sl.value/total*100)}%)`}</title></path>)}
  </svg>;
}

const LOCAL_KEY='resource-rca';
const readLocal=():Entry[]=>{try{const v=JSON.parse(localStorage.getItem(LOCAL_KEY)||'[]');return Array.isArray(v)?v:[];}catch{return [];}};
const writeLocal=(entries:Entry[])=>{try{localStorage.setItem(LOCAL_KEY,JSON.stringify(entries));}catch{/* storage unavailable */}};
const grow=(el:HTMLTextAreaElement|null)=>{if(!el)return;el.style.height='auto';el.style.height=`${el.scrollHeight}px`;};
const newId=()=>`r${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}`;

export default function ResourceRca({api,sharedSprint,onSharedSprint}:{api:Api;sharedSprint?:string;onSharedSprint?:(name:string)=>void}) {
  const [entries,setEntries]=useState<Entry[]>([]);
  const [trackerNames,setTrackerNames]=useState<string[]>([]);
  const {sprints:boardSprints}=useScrum() as {sprints:{name:string}[]};
  const [pendingDelete,setPendingDelete]=useState<Entry|null>(null);
  const sprintNames=useMemo(()=>Array.from(new Set([...boardSprints.map((s,i)=>sprintLabel(s,i)),...trackerNames])),[boardSprints,trackerNames]);
  const [loading,setLoading]=useState(true);
  const [title,setTitle]=useState('');
  const [sprint,setSprint]=useState('');
  const [reason,setReason]=useState('');
  const [search,setSearch]=useState('');
  const [reasonFilter,setReasonFilter]=useState('');
  const [openId,setOpenId]=useState<string|null>(null);
  const timer=useRef<number|undefined>(undefined);

  useEffect(()=>{
    let active=true;
    api('/resources/rca').then(data=>{if(!active)return;const rows:Entry[]=Array.isArray(data?.entries)?data.entries:[];setEntries(rows.length?rows:readLocal());}).catch(()=>{if(active)setEntries(readLocal());}).finally(()=>{if(active)setLoading(false);});
    api('/resources/sprints').then((rows:{name:string}[])=>{if(active)setTrackerNames(rows.map(r=>r.name));}).catch(()=>{});
    return()=>{active=false;};
  },[api]);

  const update=(next:Entry[])=>{
    setEntries(next);writeLocal(next);
    window.clearTimeout(timer.current);
    timer.current=window.setTimeout(()=>{void api('/resources/rca',{method:'PUT',body:JSON.stringify({entries:next})}).catch(()=>{/* kept in this browser until the server can store it */});},400);
  };
  const add=()=>{if(!title.trim()||!reason)return;update([{id:newId(),title:title.trim(),sprint:sprint.trim(),reason},...entries]);setTitle('');setReason('');};
  const patch=(id:string,change:Partial<Entry>)=>update(entries.map(e=>e.id===id?{...e,...change}:e));
  const remove=(e:Entry)=>setPendingDelete(e);
  const confirmDelete=()=>{if(pendingDelete)update(entries.filter(x=>x.id!==pendingDelete.id));setPendingDelete(null);};

  // Follow the sprint chosen on the other tabs.
  useEffect(()=>{if(sharedSprint&&sprintNames.some(n=>n.toLowerCase()===sharedSprint.toLowerCase()))setSprint(sprintNames.find(n=>n.toLowerCase()===sharedSprint.toLowerCase())||'');},[sharedSprint,sprintNames]);
  const sprintOptions=useMemo(()=>Array.from(new Set([...sprintNames,...entries.map(e=>e.sprint)].filter(Boolean))),[sprintNames,entries]);
  const visible=entries.filter(e=>(!reasonFilter||e.reason===reasonFilter)&&(!search.trim()||`${e.title} ${e.sprint}`.toLowerCase().includes(search.trim().toLowerCase())));
  const shown=visible.slice(0,20);
  const byReason=useMemo(()=>{const m=new Map<string,number>();entries.forEach(e=>m.set(e.reason,(m.get(e.reason)||0)+1));return Array.from(m.entries()).sort((a,b)=>b[1]-a[1]);},[entries]);

  const sprintOrder=useMemo(()=>[...sprintNames].reverse(),[sprintNames]);
  const perSprint=useMemo(()=>{
    const names=[...sprintOrder,...Array.from(new Set(entries.map(e=>e.sprint).filter(n=>n&&!sprintOrder.includes(n))))];
    const rows=names.map(label=>({label,value:entries.filter(e=>e.sprint===label).length}));
    const none=entries.filter(e=>!e.sprint).length;
    return none?[...rows,{label:'No sprint',value:none}]:rows;
  },[entries,sprintOrder]);
  const slices=byReason.map(([label,value],i)=>({label,value,color:PALETTE[i%PALETTE.length]}));

  if(loading)return <p role="status">Loading RCA…</p>;
  return <section className="rca">
    <div className="rca-top">
    <form className="roadmap-controls rca-add" onSubmit={e=>{e.preventDefault();add();}}>
      <label className="rca-title">Issue title<input value={title} maxLength={300} placeholder="What was missed?" onChange={e=>setTitle(e.target.value)}/></label>
      <label>Sprint<select value={sprint} onChange={e=>{setSprint(e.target.value);if(e.target.value)onSharedSprint?.(e.target.value);}}><option value="">Select a sprint</option>{sprintOptions.map(n=><option key={n}>{n}</option>)}</select></label>
      <label>Why was it missed?<select value={reason} onChange={e=>setReason(e.target.value)}><option value="">Select a reason</option>{REASONS.map(r=><option key={r}>{r}</option>)}</select></label>
      <button disabled={!title.trim()||!reason}><Plus size={15}/>Add issue</button>
    </form>
    <div className="roadmap-controls">
      <label>Search<input type="search" placeholder="filter issues or sprints" value={search} onChange={e=>setSearch(e.target.value)}/></label>
      <label>Reason<select value={reasonFilter} onChange={e=>setReasonFilter(e.target.value)}><option value="">All reasons</option>{REASONS.map(r=><option key={r}>{r}</option>)}</select></label>
      <span className="rca-summary">{entries.length} issue{entries.length===1?'':'s'}{byReason[0]?` · most common: ${byReason[0][0]} (${byReason[0][1]})`:''}</span>
    </div>
    </div>
    {entries.length>0&&<div className="rca-charts">
      <figure><figcaption>Issues per sprint</figcaption><LineChart points={perSprint}/></figure>
      <figure><figcaption>Issues by reason missed</figcaption><div className="rca-pie-wrap"><PieChart slices={slices}/><ul className="rca-legend">{slices.map(sl=><li key={sl.label}><span style={{background:sl.color}}/>{sl.label}<strong>{sl.value}</strong></li>)}</ul></div></figure>
    </div>}
    <div className="roadmap-scroll rca-scroll"><table className="roadmap-table rca-table">
      <thead><tr><th className="roadmap-no">#</th><th className="roadmap-feature">Issue title</th><th>Sprint</th><th>Why it was missed</th><th className="rca-actions-col">Action points</th><th aria-label="Actions"/></tr></thead>
      <tbody>{shown.map(e=><Fragment key={e.id}><tr className={openId===e.id?'rca-open':undefined} onClick={ev=>{if(!(ev.target as HTMLElement).closest('select,button,input,textarea'))setOpenId(openId===e.id?null:e.id);}}>
        <td className="roadmap-no">{entries.length-entries.indexOf(e)}{e.comment&&<span className="rca-note-dot" title="Has comments" aria-label="Has comments"/>}</td>
        <td className="roadmap-feature"><input aria-label="Issue title" defaultValue={e.title} key={e.title} onFocus={()=>setOpenId(e.id)} onBlur={ev=>{const t=ev.target.value.trim();if(t&&t!==e.title)patch(e.id,{title:t});else ev.target.value=e.title;}}/></td>
        <td><select aria-label={`Sprint for ${e.title}`} value={e.sprint} onChange={ev=>patch(e.id,{sprint:ev.target.value})}><option value="">—</option>{sprintOptions.map(n=><option key={n}>{n}</option>)}</select></td>
        <td><select aria-label={`Reason for ${e.title}`} value={e.reason} onChange={ev=>patch(e.id,{reason:ev.target.value})}>{Array.from(new Set([...REASONS,e.reason])).map(r=><option key={r}>{r}</option>)}</select></td>
        <td className="rca-actions-col"><input aria-label={`Action points for ${e.title}`} placeholder="Add action points" maxLength={1000} defaultValue={e.actions||''} key={e.actions||''} onBlur={ev=>{if(ev.target.value.trim()!==(e.actions||''))patch(e.id,{actions:ev.target.value.trim()});}}/></td>
        <td><button className="secondary" aria-label={`Delete ${e.title}`} onClick={()=>remove(e)}><Trash2 size={14}/></button></td>
      </tr>{openId===e.id&&<tr className="rca-comment-row"><td/><td colSpan={5}><label>Comments<textarea rows={3} ref={grow} onInput={ev=>grow(ev.currentTarget)} maxLength={5000} placeholder="Add comments about this issue: what happened, impact, how to prevent it…" defaultValue={e.comment||''} onBlur={ev=>{if(ev.target.value!==(e.comment||''))patch(e.id,{comment:ev.target.value});}}/></label></td></tr>}</Fragment>)}</tbody>
    </table>{visible.length>20&&<p className="rca-limit">Showing the latest 20 of {visible.length} issues. Use the filters to narrow the list.</p>}{!visible.length&&<p className="task-empty">{entries.length?'No issues match these filters.':'No issues logged yet. Add the first one above.'}</p>}</div>
    {pendingDelete&&<div className="rca-modal-backdrop" onClick={()=>setPendingDelete(null)}><div className="rca-modal" role="alertdialog" aria-modal="true" aria-labelledby="rca-del-title" onClick={ev=>ev.stopPropagation()} onKeyDown={ev=>{if(ev.key==='Escape')setPendingDelete(null);}}>
      <h3 id="rca-del-title">Delete this issue?</h3>
      <p>“{pendingDelete.title}” will be removed from the RCA list. This can’t be undone.</p>
      <div className="rca-modal-actions"><button type="button" className="secondary" autoFocus onClick={()=>setPendingDelete(null)}>Cancel</button><button type="button" className="rca-danger" onClick={confirmDelete}>Delete</button></div>
    </div></div>}
  </section>;
}

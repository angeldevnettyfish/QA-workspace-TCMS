import {Fragment, useEffect, useMemo, useRef, useState} from 'react';
import {Plus, Trash2} from 'lucide-react';

type Api = (path:string, options?:RequestInit)=>Promise<any>;
type Feature = {id:string;title:string;status:string;months:Record<string,string>};
const STATUSES = ['Planned','To Do','In Progress','Testing','Blocked','Done'] as const;
const monthKey=(d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
const addMonths=(start:string,n:number)=>{const [y,m]=start.split('-').map(Number);return monthKey(new Date(y,m-1+n,1));};
const monthLabel=(key:string)=>{const [y,m]=key.split('-').map(Number);return new Date(y,m-1,1).toLocaleString(undefined,{month:'short',year:'numeric'}).toUpperCase();};
const tone=(status:string)=>status?`roadmap-s-${status.toLowerCase().replace(/\s+/g,'-')}`:'';
const LOCAL_KEY='resource-roadmap';
const readLocal=():Feature[]=>{try{const v=JSON.parse(localStorage.getItem(LOCAL_KEY)||'[]');return Array.isArray(v)?v:[];}catch{return [];}};
const writeLocal=(features:Feature[])=>{try{localStorage.setItem(LOCAL_KEY,JSON.stringify(features));}catch{/* storage unavailable */}};
const newId=()=>`f${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}`;

export default function ResourceRoadmap({api}:{api:Api}) {
  const [features,setFeatures]=useState<Feature[]>([]);
  const [loading,setLoading]=useState(true);
  
  const [from,setFrom]=useState(monthKey(new Date()));
  const [count,setCount]=useState(12);
  const [order,setOrder]=useState<'month'|'sheet'>('month');
  const [search,setSearch]=useState('');
  const [statusFilter,setStatusFilter]=useState<string[]>([]);
  const [newTitle,setNewTitle]=useState('');
  const timer=useRef<number|undefined>(undefined);

  useEffect(()=>{
    let active=true;
    api('/resources/roadmap').then(data=>{if(!active)return;const rows:Feature[]=Array.isArray(data?.features)?data.features:[];setFeatures(rows.length?rows:readLocal());}).catch(()=>{if(active)setFeatures(readLocal());}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[api]);

  const update=(next:Feature[])=>{
    setFeatures(next);writeLocal(next);
    window.clearTimeout(timer.current);
    timer.current=window.setTimeout(async()=>{

      try{await api('/resources/roadmap',{method:'PUT',body:JSON.stringify({features:next})});}
      catch{/* kept in this browser until the server can store it */}

    },400);
  };
  const patch=(id:string,change:Partial<Feature>)=>update(features.map(f=>f.id===id?{...f,...change}:f));
  const setCell=(f:Feature,key:string,value:string)=>{const months={...f.months};if(value)months[key]=value;else delete months[key];patch(f.id,{months});};
  const add=()=>{const title=newTitle.trim();if(!title)return;update([...features,{id:newId(),title,status:'Planned',months:{}}]);setNewTitle('');};
  const remove=(f:Feature)=>{if(window.confirm(`Delete "${f.title}" from the roadmap?`))update(features.filter(x=>x.id!==f.id));};

  const months=useMemo(()=>Array.from({length:Math.max(1,Math.min(36,count))},(_,i)=>addMonths(from,i)),[from,count]);
  const current=monthKey(new Date());
  const counts=useMemo(()=>Object.fromEntries(STATUSES.map(s=>[s,features.filter(f=>f.status===s).length])) as Record<string,number>,[features]);
  const number=(f:Feature)=>features.indexOf(f)+1;
  const visible=features.filter(f=>(!statusFilter.length||statusFilter.includes(f.status))&&(!search.trim()||f.title.toLowerCase().includes(search.trim().toLowerCase())));
  const thisMonth=(f:Feature)=>!!f.months[current]&&f.status!=='Done';
  const groups:{label:string;rows:Feature[]}[]=order==='sheet'?[{label:'',rows:visible}]:[
    {label:`This month · ${monthLabel(current)}`,rows:visible.filter(thisMonth)},
    {label:'To do next',rows:visible.filter(f=>!thisMonth(f)&&f.status==='To Do')},
    {label:'Everything else',rows:visible.filter(f=>!thisMonth(f)&&f.status!=='To Do')},
  ].filter(g=>g.rows.length);
  const toggle=(s:string)=>setStatusFilter(cur=>cur.includes(s)?cur.filter(x=>x!==s):[...cur,s]);

  if(loading)return <p role="status">Loading roadmap…</p>;
  return <section className="roadmap">
    <div className="roadmap-head">
      <div className="roadmap-stats">{([['features',features.length],['planned',counts.Planned],['to do',counts['To Do']],['in progress',counts['In Progress']],['done',counts.Done]] as [string,number][]).map(([label,value])=><div key={label}><strong>{value}</strong><small>{label}</small></div>)}</div>
    </div>
    <div className="roadmap-controls">
      <label>From<input type="month" value={from} onChange={e=>e.target.value&&setFrom(e.target.value)}/></label>
      <label>Months<input type="number" min={1} max={36} value={count} onChange={e=>setCount(Number(e.target.value)||1)}/></label>
      <label>Order<select value={order} onChange={e=>setOrder(e.target.value as 'month'|'sheet')}><option value="month">This month first</option><option value="sheet">Sheet order</option></select></label>
      <label>Search<input type="search" placeholder="filter features" value={search} onChange={e=>setSearch(e.target.value)}/></label>
      <div className="roadmap-chips" role="group" aria-label="Status filter"><span>Status</span><div>{STATUSES.map(s=><button type="button" key={s} className={`secondary roadmap-chip${statusFilter.includes(s)?' on':''}`} aria-pressed={statusFilter.includes(s)} onClick={()=>toggle(s)}>{s} <small>{counts[s]}</small></button>)}</div></div>
      <form className="roadmap-add" onSubmit={e=>{e.preventDefault();add();}}><input aria-label="New feature" placeholder="New feature name" value={newTitle} onChange={e=>setNewTitle(e.target.value)}/><button disabled={!newTitle.trim()}><Plus size={15}/>Add feature</button></form>
    </div>
    <div className="roadmap-scroll"><table className="roadmap-table">
      <thead><tr><th className="roadmap-no">Sl.no</th><th className="roadmap-feature">Feature</th><th>Status</th>{months.map(m=><th key={m} className={m===current?'roadmap-now':''}>{monthLabel(m)}</th>)}<th aria-label="Actions"/></tr></thead>
      <tbody>
        {groups.map(g=><Fragment key={g.label||'all'}>{g.label&&<tr className="roadmap-group"><td colSpan={months.length+4}>{g.label} <small>{g.rows.length}</small></td></tr>}
          {g.rows.map(f=><tr key={f.id}>
            <td className="roadmap-no">{number(f)}</td>
            <td className="roadmap-feature"><input aria-label={`Feature ${number(f)} name`} defaultValue={f.title} key={f.title} onBlur={e=>{const t=e.target.value.trim();if(t&&t!==f.title)patch(f.id,{title:t});else e.target.value=f.title;}}/></td>
            <td><select className={tone(f.status)} aria-label={`Status of ${f.title}`} value={f.status} onChange={e=>patch(f.id,{status:e.target.value})}>{STATUSES.map(s=><option key={s}>{s}</option>)}</select></td>
            {months.map(m=><td key={m}><select className={tone(f.months[m]||'')} aria-label={`${f.title} in ${monthLabel(m)}`} value={f.months[m]||''} onChange={e=>setCell(f,m,e.target.value)}><option value="">—</option>{STATUSES.map(s=><option key={s}>{s}</option>)}</select></td>)}
            <td><button className="secondary" aria-label={`Delete ${f.title}`} onClick={()=>remove(f)}><Trash2 size={14}/></button></td>
          </tr>)}</Fragment>)}
      </tbody>
    </table>{!visible.length&&<p className="task-empty">{features.length?'No features match these filters.':'No features yet. Add the first one above.'}</p>}</div>
  </section>;
}

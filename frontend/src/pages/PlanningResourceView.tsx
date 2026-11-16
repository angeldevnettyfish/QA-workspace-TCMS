import {useEffect, useMemo, useState} from 'react';
import {ArrowLeft, CheckCircle2, Clock, List, Users, AlertCircle} from 'lucide-react';
import {Panel, Table} from '../components/ui';
import {entryHours, spentHours, sprintLabel} from '../pm/lib/scrum';
import {useScrum} from '../pm/lib/scrumState';

const fmt=(value:number)=>Number(value||0).toLocaleString(undefined,{maximumFractionDigits:2});
const timeByPerson=(task:any,ownerId:string,people:{id:string;name:string}[])=>{
  const entries=task.entries.filter((entry:any)=>!entry.deletedAt);
  if(!entries.length)return task.spent?`${people.find(person=>person.id===ownerId)?.name||'Unassigned'} ${fmt(task.spent)}h`:'—';
  const totals=new Map<string,number>();
  entries.forEach((entry:any)=>{
    const memberId=entry.memberId||ownerId;
    totals.set(memberId,(totals.get(memberId)||0)+entryHours(entry));
  });
  return [...totals].map(([memberId,hours])=>`${people.find(person=>person.id===memberId)?.name||'Unassigned'} ${fmt(hours)}h`).join(', ');
};

function Metric({value,label,tone='tasks'}:{value:number;label:string;tone?:string}) {
  return <div className={`resource-round-metric ${tone}`}><div><strong title={fmt(value)}>{fmt(value)}</strong><span>{label}</span></div></div>;
}

export default function PlanningResourceView({taskView=false,api}:{taskView?:boolean;api:(path:string)=>Promise<any>}) {
  const {people,sprints,view,setView}=useScrum() as {
    people:{id:string;name:string;tasks:Record<string,any>[]}[];
    sprints:{id:string;name:string;start?:string;end?:string}[];
    view:{planSprintId:string|null;[key:string]:any};
    setView:(update:(current:any)=>any)=>void;
  };
  const [resourceSprints,setResourceSprints]=useState<{id:number;name:string}[]>([]);
  useEffect(()=>{let active=true;void api('/resources/sprints').then(rows=>{if(active)setResourceSprints(rows);}).catch(()=>{if(active)setResourceSprints([]);});return()=>{active=false;};},[api]);
  const [sprintId,setSprintId]=useState('');
  useEffect(()=>{
    if(!sprints.length)return;
    const requested=new URLSearchParams(window.location.search).get('sprint');
    const legacyName=resourceSprints.find(item=>String(item.id)===requested)?.name.trim().toLowerCase();
    const selected=sprints.find(s=>s.id===requested)?.id
      ??sprints.find(s=>legacyName&&s.name.trim().toLowerCase()===legacyName)?.id
      ??sprints.find(s=>s.id===view.planSprintId)?.id
      ??sprints[0].id;
    setSprintId(selected);
    if(view.planSprintId!==selected)setView(current=>({...current,planSprintId:selected}));
  },[sprints,resourceSprints,view.planSprintId,setView]);

  const sprint=sprints.find(item=>item.id===sprintId);
  const rows=useMemo(()=>people.flatMap(person=>person.tasks
    .filter(task=>task.sprintId===sprintId)
    .map(task=>({person,task}))),[people,sprintId]);
  const testers=useMemo(()=>new Set(rows.map(({person})=>person.id)).size,[rows]);
  const totals=useMemo(()=>rows.reduce((sum,{task})=>({
    tasks:sum.tasks+1,
    completed:sum.completed+(task.status==='Done'?1:0),
    estimated:sum.estimated+(task.estimate||0),
    actual:sum.actual+spentHours(task),
    unplanned:sum.unplanned+(task.unplannedHours||0),
    blocked:sum.blocked+(task.status==='Blocked'?1:0),
    tests:sum.tests+(task.testCases||0),
    defects:sum.defects+(task.issues||0)
  }),{tasks:0,completed:0,estimated:0,actual:0,unplanned:0,blocked:0,tests:0,defects:0}),[rows]);

  const selectedUrl=new URL(window.location.href);
  selectedUrl.searchParams.set('sprint',sprintId);
  const tasksUrl=new URL(selectedUrl);
  tasksUrl.searchParams.set('view','sprint-tasks');
  const overviewUrl=new URL(selectedUrl);
  overviewUrl.searchParams.delete('view');
  const planningUrl=new URL(selectedUrl);
  planningUrl.searchParams.delete('view');planningUrl.searchParams.set('tab','planning');

  return <div className="resource-page">
    <div className="resource-toolbar">
      <div><h2>{taskView?`${sprint?.name??'Sprint'} · Tasks`:'Sprint planning summary'}</h2><p>Planning is the source for sprint details shown here.</p></div>
      <div className="resource-actions">
        {taskView&&<a className="resource-back" href={overviewUrl.href}><ArrowLeft size={16}/>Back</a>}
        <a className="secondary resource-open-tasks" href={planningUrl.href}>Open Planning</a>
      </div>
    </div>

    {!taskView&&<div className="resource-sprint-bar">
      <div className="resource-sprint-selection"><label>Sprint<select aria-label="Sprint" value={sprintId} onChange={event=>{
        const next=event.target.value;setSprintId(next);setView(current=>({...current,planSprintId:next}));
        const url=new URL(window.location.href);url.searchParams.set('sprint',next);window.history.replaceState(null,'',url);
      }}>
        {sprints.map((item,index)=><option key={item.id} value={item.id}>{sprintLabel(item,index)}</option>)}
      </select></label>{sprint&&<a className="resource-open-tasks" href={tasksUrl.href}><List size={16}/>Tasks</a>}</div>
    </div>}

    {!sprints.length?<Panel title="No planning sprints"><p>Create a sprint in Planning to see its details here.</p></Panel>:<>
      {!taskView&&<>
        <div className="resource-stats">
          <div className="resource-summary-stat"><Users size={18}/><span>Tasks / testers</span><div className="resource-round-metrics"><Metric value={totals.tasks} label="Tasks"/><Metric value={testers} label="Testers" tone="testers"/></div><small>{totals.completed} completed</small></div>
          <div className="resource-summary-stat"><Clock size={18}/><span>Estimated / actual hours</span><div className="resource-round-metrics"><Metric value={totals.estimated} label="Estimated"/><Metric value={totals.actual} label="Actual" tone="testers"/></div><small>Hours · {fmt(totals.actual-totals.estimated)}h variance</small></div>
          <div className="resource-summary-stat"><AlertCircle size={18}/><span>Unplanned effort</span><div className="resource-round-metrics"><Metric value={totals.unplanned} label="Hours" tone="effort"/><Metric value={totals.blocked} label="Blocked" tone="defects"/></div><small>Planning task hours / blocked tasks</small></div>
          <div className="resource-summary-stat"><CheckCircle2 size={18}/><span>Test cases / defects</span><div className="resource-round-metrics"><Metric value={totals.tests} label="Test cases"/><Metric value={totals.defects} label="Defects" tone="defects"/></div><small>Recorded in Planning</small></div>
        </div>
        <Panel title={sprint?`Planning details · ${sprint.name}`:'Planning details'}>
          {rows.length===0?<p>No tasks are assigned to this sprint in Planning yet.</p>:<Table headers={['Task','Tester','Status','Estimated h','Actual h','Time by person','Unplanned h','Test cases','Defects']}>
            {rows.map(({person,task})=><tr key={task.id}><td>{task.title||'Untitled task'}</td><td>{person.name||'Unnamed'}</td><td>{task.status}</td><td>{fmt(task.estimate)}</td><td>{fmt(spentHours(task))}</td><td>{timeByPerson(task,person.id,people)}</td><td>{fmt(task.unplannedHours)}</td><td>{fmt(task.testCases)}</td><td>{fmt(task.issues)}</td></tr>)}
          </Table>}
          <p className="resource-hint">Edit task details and unplanned hours in the Planning tab; this view follows those changes.</p>
        </Panel>
      </>}

      {taskView&&<section className="resource-tracker">
        <div className="resource-tracker-heading"><h3>{sprint?.name??'Sprint'} · Planning tasks</h3><a className="resource-back" href={planningUrl.href}>Open Planning</a></div>
        <div className="resource-table-meta"><span>{rows.length} tasks from Planning</span></div>
        <Table headers={['Task','Tester','Status','Estimated h','Actual h','Time by person','Unplanned h','Test result','Test cases','Defects','Notes']}>
          {rows.map(({person,task})=><tr key={task.id}><td>{task.title||'Untitled task'}</td><td>{person.name||'Unnamed'}</td><td>{task.status}</td><td>{fmt(task.estimate)}</td><td>{fmt(spentHours(task))}</td><td>{timeByPerson(task,person.id,people)}</td><td>{fmt(task.unplannedHours)}</td><td>{task.testResult}</td><td>{fmt(task.testCases)}</td><td>{fmt(task.issues)}</td><td className="resource-comment-cell">{task.notes||'—'}</td></tr>)}
        </Table>
        {rows.length===0&&<p>No tasks are assigned to this sprint in Planning yet.</p>}
      </section>}
    </>}
  </div>;
}
